import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sanitizeMermaidDiagram } from '@/lib/mermaid';

export interface AiInput {
  fileTree: string;
  keyFiles: Record<string, string>;
  userApiKeys?: { name: string; key: string }[];
}

export interface AiOutput {
  overview: string;
  structureExplanation: string;
  functionBreakdowns: string;
  mermaidDiagram: string;
  fullMarkdown: string;
}

type ProviderName = 'openai' | 'anthropic' | 'xai' | 'google' | 'deepseek' | 'groq' | 'mistral' | 'huggingface';

// BYOK keys are stored under the labels offered in the UI ("grok", "gemini", …)
// while the runner below uses canonical ids ("xai", "google"). Without this map
// user-supplied keys never resolve and every section silently fails over.
const PROVIDER_ALIASES: Record<string, ProviderName> = {
  openai: 'openai',
  gpt: 'openai',
  anthropic: 'anthropic',
  claude: 'anthropic',
  xai: 'xai',
  grok: 'xai',
  google: 'google',
  gemini: 'google',
  deepseek: 'deepseek',
  groq: 'groq',
  mistral: 'mistral',
  huggingface: 'huggingface',
  hf: 'huggingface',
};

function canonicalProvider(name: string): string {
  const key = name.trim().toLowerCase();
  return PROVIDER_ALIASES[key] ?? key;
}

function resolveKey(
  provider: ProviderName,
  userApiKeys?: { name: string; key: string }[]
): string {
  // 1. Check BYOK (only return if key actually has a value)
  if (userApiKeys) {
    const match = userApiKeys.find(
      (k) => canonicalProvider(k.name) === canonicalProvider(provider)
    );
    if (match && match.key && match.key.trim() !== '') {
      return match.key;
    }
  }

  // 2. Check Paid/Free Env Vars
  const envMap: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    xai: process.env.XAI_API_KEY,
    google: process.env.GOOGLE_GEMINI_PAID_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    groq: process.env.GROQ_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    huggingface: process.env.HUGGINGFACE_API_KEY,
  };

  return envMap[provider] ?? '';
}

function buildFileContext(keyFiles: Record<string, string>): string {
  let context = '';
  let totalLength = 0;
  const MAX_CONTEXT_LENGTH = 12000;

  for (const [path, content] of Object.entries(keyFiles)) {
    const section = `### ${path}\n\`\`\`\n${content}\n\`\`\`\n\n`;
    if (totalLength + section.length > MAX_CONTEXT_LENGTH) {
      context += `\n[... Remaining files omitted due to context size limits ...]`;
      break;
    }
    context += section;
    totalLength += section.length;
  }
  return context;
}

// ─── OpenAI Compatible ──────────────────────────
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
// `llama-3.3-70b-versatile` was retired on Groq (2026-08-16) and now 404s on
// the free tier — GPT-OSS 120B is Groq's published replacement.
const GROQ_MODEL = 'openai/gpt-oss-120b';

async function runOpenAICompatible(params: {
  provider: ProviderName;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  baseURL?: string;
  maxTokens?: number;
  tokenBudgetField?: 'max_tokens' | 'max_completion_tokens';
}): Promise<string> {
  if (!params.apiKey) throw new Error(`${params.provider} API key missing`);
  const client = new OpenAI({
    apiKey: params.apiKey,
    baseURL: params.baseURL,
    timeout: 60_000,
    maxRetries: 1,
  });
  const response = await client.chat.completions.create({
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.prompt },
    ],
    // Groq deprecates `max_tokens`; GPT-OSS also burns completion budget on
    // reasoning, so its sections get a larger ceiling.
    ...(params.tokenBudgetField === 'max_completion_tokens'
      ? { max_completion_tokens: params.maxTokens ?? 8192 }
      : { max_tokens: params.maxTokens ?? 4096 }),
  });
  const content = response.choices[0]?.message?.content ?? '';
  if (!content.trim()) {
    throw new Error(`${params.provider} returned an empty response`);
  }
  return content;
}

async function runGroq(params: {
  apiKey: string;
  system: string;
  prompt: string;
}): Promise<string> {
  return runOpenAICompatible({
    provider: 'groq',
    apiKey: params.apiKey,
    baseURL: GROQ_BASE_URL,
    model: GROQ_MODEL,
    system: params.system,
    prompt: params.prompt,
    maxTokens: 8192,
    tokenBudgetField: 'max_completion_tokens',
  });
}

// ─── Gemini ──────────────────────────────────────────────────────────────────
async function runGemini(params: {
  apiKey: string;
  prompt: string;
  system?: string;
}): Promise<string> {
  if (!params.apiKey) throw new Error('Gemini API key missing');
  const genAI = new GoogleGenerativeAI(params.apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const fullPrompt = params.system ? `${params.system}\n\n${params.prompt}` : params.prompt;
  
  let attempts = 0;
  while (attempts < 2) {
    try {
      const result = await model.generateContent(fullPrompt);
      return result.response.text();
    } catch (e) {
      const status =
        typeof e === 'object' && e !== null && 'status' in e
          ? (e as { status?: unknown }).status
          : undefined;
      if (status === 429 && attempts === 0) {
        await new Promise(r => setTimeout(r, 3000));
        attempts++;
        continue;
      }
      throw e;
    }
  }
  throw new Error('Gemini failed after retries');
}

// ─── Anthropic ───────────────────────────────────────────────────────────────
async function runAnthropic(params: {
  apiKey: string;
  prompt: string;
  system: string;
}): Promise<string> {
  if (!params.apiKey) throw new Error('Anthropic API key missing');
  const client = new Anthropic({ apiKey: params.apiKey, timeout: 60_000 });
  const message = await client.messages.create({
    model: 'claude-3-5-haiku-latest',
    max_tokens: 4096,
    system: params.system,
    messages: [{ role: 'user', content: params.prompt }],
  });
  return message.content[0].type === 'text' ? message.content[0].text : '';
}

// ─── Mistral ─────────────────────────────────────────────────────────────────
async function runMistral(params: {
  apiKey: string;
  prompt: string;
  system: string;
}): Promise<string> {
  if (!params.apiKey) throw new Error('Mistral API key missing');
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.prompt },
      ],
    }),
  });
  const data = await response.json();
  return data.choices[0]?.message?.content ?? '';
}

// ─── Hugging Face ────────────────────────────────────────────────────────────
async function runHuggingFace(params: {
  apiKey: string;
  prompt: string;
  system: string;
}): Promise<string> {
  if (!params.apiKey) throw new Error('Hugging Face API key missing');
  const response = await fetch('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      inputs: `<s>[INST] ${params.system}\n\n${params.prompt} [/INST]`,
      parameters: { max_new_tokens: 1024 },
    }),
  });
  const data = await response.json();
  return Array.isArray(data) ? data[0]?.generated_text : data.generated_text ?? '';
}

// ─── Local Analysis (Last Resort) ───────────────────────────────────────────
function runLocalAnalysis(params: {
  type: 'overview' | 'structure' | 'functions' | 'architecture';
  fileTree: string;
  keyFiles: Record<string, string>;
}): string {
  const { type, fileTree, keyFiles } = params;
  
  if (type === 'overview') {
    let pkgJson: { name?: string; description?: string; dependencies?: Record<string, string> } | null = null;
    try {
      pkgJson = keyFiles['package.json'] ? JSON.parse(keyFiles['package.json']) : null;
    } catch {
      pkgJson = null;
    }
    const name = pkgJson?.name || 'this project';
    const desc = pkgJson?.description || 'a custom codebase';
    const deps = pkgJson?.dependencies ? Object.keys(pkgJson.dependencies).join(', ') : 'various libraries';
    
    return `### Local Analysis Overview\nThis project, **${name}**, is ${desc}. \n\n**Key Stack Identified:** ${deps}.\n\n*Note: This overview was generated via local rule-based analysis because AI providers were unavailable.*`;
  }
  
  if (type === 'structure') {
    const lines = fileTree.split('\n').filter(l => l.trim()).slice(0, 20);
    return `### Directory Structure\nThe codebase contains the following primary files and directories:\n\n${lines.map(l => `- \`${l}\``).join('\n')}\n\n*Generated via local analysis.*`;
  }

  if (type === 'functions') {
    return `### Core Functionality\nBased on the file tree, this project implements logic across ${Object.keys(keyFiles).length} key source files including ${Object.keys(keyFiles).slice(0, 3).join(', ')}. \n\n*Generated via local analysis.*`;
  }

  if (type === 'architecture') {
    const reasoning = `### Architecture Reasoning\nThe project follows a standard modular structure.`;
    const mermaid = `graph TD\n  Root --> Source`;
    return JSON.stringify({ architectureReasoning: reasoning, mermaidDiagram: mermaid });
  }

  return '[Local analysis failed]';
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function generateDocumentation(params: AiInput): Promise<AiOutput> {
  const { fileTree, keyFiles, userApiKeys } = params;
  const fileContext = buildFileContext(keyFiles);

  const subtasks = [
    // 1. Overview
    async () => {
      const providers: { name: ProviderName; run: () => Promise<string> }[] = [
        {
          name: 'groq',
          run: () => runGroq({
            apiKey: resolveKey('groq', userApiKeys),
            system: 'You are an elite technical architect and writer.',
            prompt: `Carefully analyze these source files to identify the project's unique purpose, core tech stack, and primary problem it solves. 
Write a highly detailed, comprehensive project overview (4-6 paragraphs).
Include a "Tech Stack at a Glance" Markdown TABLE with columns: Category, Technology, and Purpose.
CRITICAL: You MUST include the header separator line (e.g., | Category | Technology | Purpose |\n|---|---|---|).
Mention specific frameworks, state management, styling, and database libraries found.\n\n${fileContext}`
          })
        },
        {
          name: 'google',
          run: () => runGemini({
            apiKey: resolveKey('google', userApiKeys),
            system: 'You are an elite technical architect and writer.',
            prompt: `Carefully analyze these source files to identify the project's unique purpose, core tech stack, and primary problem it solves. 
Write a highly detailed, comprehensive project overview (4-6 paragraphs).
Include a "Tech Stack at a Glance" Markdown TABLE with columns: Category, Technology, and Purpose.
CRITICAL: You MUST include the header separator line (e.g., | Category | Technology | Purpose |\n|---|---|---|) for the table to render correctly.
Mention specific frameworks, state management, styling, and database libraries found.\n\n${fileContext}`
          })
        },
        {
          name: 'mistral',
          run: () => runMistral({
            apiKey: resolveKey('mistral', userApiKeys),
            system: 'You are an elite technical writer.',
            prompt: `Carefully analyze these source files to identify the project's unique purpose, core tech stack, and primary problem it solves. 
Write a highly detailed, comprehensive project overview (4-6 paragraphs).
Include a "Tech Stack at a Glance" Markdown TABLE with columns: Category, Technology, and Purpose.
CRITICAL: You MUST include the header separator line (e.g., | Category | Technology | Purpose |\n|---|---|---|).\n\n${fileContext}`
          })
        }
      ];

      for (const p of providers) {
        if (!resolveKey(p.name, userApiKeys)) continue;
        try {
          return await p.run();
        } catch (e) {
          console.error(`[AI:Overview] ${p.name} failed:`, e);
        }
      }
      return runLocalAnalysis({ type: 'overview', fileTree, keyFiles });
    },

    // 2. Structure Explanation
    async () => {
      const providers: { name: ProviderName; run: () => Promise<string> }[] = [
        {
          name: 'groq',
          run: () => runGroq({
            apiKey: resolveKey('groq', userApiKeys),
            system: 'You are a senior codebase analyst.',
            prompt: `Analyze this codebase file structure in extreme detail. 
Group the files into logical categories (e.g., Authentication, UI Components, API/Services, State Management, Database Models, Utils).
Produce a detailed Markdown TABLE for the file structure with columns: Category, Sub-folder, and Key Responsibility.
CRITICAL: You MUST include the header separator line (e.g., | Category | Sub-folder | Key Responsibility |\n|---|---|---|).
Explain the architectural patterns (e.g., MVC, Onion, Clean Architecture) being used with technical precision.\n\n${fileTree}`
          })
        },
        {
          name: 'google',
          run: () => runGemini({
            apiKey: resolveKey('google', userApiKeys),
            system: 'You are a senior codebase analyst.',
            prompt: `Analyze this codebase file structure in extreme detail and provide a categorized Markdown table of files.
CRITICAL: You MUST include the header separator line (e.g., | Category | Files | Responsibility |\n|---|---|---|).\n\n${fileTree}`
          })
        },
        {
          name: 'xai',
          run: () => runOpenAICompatible({
            provider: 'xai',
            apiKey: resolveKey('xai', userApiKeys),
            baseURL: 'https://api.x.ai/v1',
            model: 'grok-2',
            system: 'You are a senior codebase analyst.',
            prompt: `Analyze this codebase file structure in extreme detail. 
Group the files into logical categories (e.g., Authentication, UI Components, API/Services, State Management, Database Models, Utils).
Produce a detailed Markdown TABLE for the file structure with columns: Category, Sub-folder, and Key Responsibility.
CRITICAL: You MUST include the header separator line (e.g., | Category | Sub-folder | Key Responsibility |\n|---|---|---|).
Explain the architectural patterns (e.g., MVC, Onion, Clean Architecture) being used with technical precision.\n\n${fileTree}`
          })
        },
        {
          name: 'mistral',
          run: () => runMistral({
            apiKey: resolveKey('mistral', userApiKeys),
            system: 'You are a senior codebase analyst.',
            prompt: `Analyze this codebase file structure in extreme detail and provide a categorized Markdown table of files.
CRITICAL: You MUST include the header separator line (e.g., | Category | Files | Responsibility |\n|---|---|---|).\n\n${fileTree}`
          })
        }
      ];

      for (const p of providers) {
        if (!resolveKey(p.name, userApiKeys)) continue;
        try {
          return await p.run();
        } catch (e) {
          console.error(`[AI:Structure] ${p.name} failed:`, e);
        }
      }
      return runLocalAnalysis({ type: 'structure', fileTree, keyFiles });
    },

    // 3. Function Breakdowns
    async () => {
      const providers: { name: ProviderName; run: () => Promise<string> }[] = [
        {
          name: 'groq',
          run: () => runGroq({
            apiKey: resolveKey('groq', userApiKeys),
            system: 'You are a senior software engineer.',
            prompt: `Analyze the provided source files and produce an exhaustive, function-level code breakdown. 
For each key file, provide a Markdown TABLE with columns: Function/Export Name, Parameters, Logic Description, and Impact.
CRITICAL: You MUST include the header separator line (e.g., | Name | Params | Logic | Impact |\n|---|---|---|---|).
Ensure no significant utility or hook is missed. Format with deep technical insight.\n\n${fileContext}`
          })
        },
        {
          name: 'deepseek',
          run: () => runOpenAICompatible({
            provider: 'deepseek',
            apiKey: resolveKey('deepseek', userApiKeys),
            baseURL: 'https://api.deepseek.com/v1',
            model: 'deepseek-chat',
            system: 'You are a senior software engineer.',
            prompt: `Produce an exhaustive, function-level code breakdown table for these files.
CRITICAL: You MUST include the header separator line (e.g., | Name | Params | Logic | Impact |\n|---|---|---|---|).\n\n${fileContext}`
          })
        },
        {
          name: 'openai',
          run: () => runOpenAICompatible({
            provider: 'openai',
            apiKey: resolveKey('openai', userApiKeys),
            model: 'gpt-4o-mini',
            system: 'You are a senior software engineer.',
            prompt: `Analyze the provided source files and produce an exhaustive, function-level code breakdown. 
For each key file, provide a Markdown TABLE with columns: Function/Export Name, Parameters, Logic Description, and Impact.
CRITICAL: You MUST include the header separator line (e.g., | Name | Params | Logic | Impact |\n|---|---|---|---|).\n\n${fileContext}`
          })
        },
        {
          name: 'huggingface',
          run: () => runHuggingFace({
            apiKey: resolveKey('huggingface', userApiKeys),
            system: 'You are a senior software engineer.',
            prompt: `Produce an exhaustive, function-level code breakdown table for these files.
CRITICAL: You MUST include the header separator line (e.g., | Name | Params | Logic | Impact |\n|---|---|---|---|).\n\n${fileContext}`
          })
        },
        {
          name: 'mistral',
          run: () => runMistral({
            apiKey: resolveKey('mistral', userApiKeys),
            system: 'You are a senior software engineer.',
            prompt: `Produce an exhaustive, function-level code breakdown table for these files.
CRITICAL: You MUST include the header separator line (e.g., | Name | Params | Logic | Impact |\n|---|---|---|---|).\n\n${fileContext}`
          })
        }
      ];

      for (const p of providers) {
        if (!resolveKey(p.name, userApiKeys)) continue;
        try {
          return await p.run();
        } catch (e) {
          console.error(`[AI:Functions] ${p.name} failed:`, e);
        }
      }
      return runLocalAnalysis({ type: 'functions', fileTree, keyFiles });
    },

    // 4. Architecture + Mermaid
    async () => {
      const providers: { name: ProviderName; run: () => Promise<string> }[] = [
        {
          name: 'groq',
          run: () => runGroq({
            apiKey: resolveKey('groq', userApiKeys),
            system: 'You are an expert software architect.',
            prompt: `Deconstruct the architecture of this specific repository in extreme detail. 
1. Write a deep-dive architecture reasoning section explaining module interactions and advanced design patterns.
2. Include a "Data Flow & State Transitions" Markdown TABLE with columns: Origin, Action, Logic Handler, and Resulting State.
CRITICAL: You MUST include the header separator line (e.g., | Origin | Action | Handler | Result |\n|---|---|---|---|).
3. Generate a high-detail Mermaid.js diagram (graph TD). 
   - USE SUBGRAPHS to logically group components (e.g., "Frontend Layer", "API & Middleware", "Data Persistence", "External Integrations").
   - Focus on actual components found in the files.

CRITICAL: In the Mermaid diagram, NODE IDs MUST be simple alphanumeric strings (e.g., A, B, C, file1). NEVER use file paths, slashes, or parentheses in Node IDs. Put the descriptive names or file paths in the node labels only, like this: A["app/page.tsx"] --> B["lib/utils.ts"].

FILE TREE:
${fileTree}

FILES:
${fileContext}`
          })
        },
        {
          name: 'google',
          run: () => runGemini({
            apiKey: resolveKey('google', userApiKeys),
            system: 'You are an expert software architect.',
            prompt: `Deconstruct the architecture of this specific repository in extreme detail. 
1. Write a deep-dive architecture reasoning section explaining module interactions and advanced design patterns.
2. Include a "Data Flow & State Transitions" Markdown TABLE with columns: Origin, Action, Logic Handler, and Resulting State.
CRITICAL: You MUST include the header separator line (e.g., | Origin | Action | Handler | Result |\n|---|---|---|---|).
3. Generate a high-detail Mermaid.js diagram (graph TD). 

CRITICAL: In the Mermaid diagram, NODE IDs MUST be simple alphanumeric strings (e.g., A, B, C, file1). NEVER use file paths, slashes, or parentheses in Node IDs. Put the descriptive names or file paths in the node labels only, like this: A["app/page.tsx"] --> B["lib/utils.ts"].

FILE TREE:
${fileTree}

FILES:
${fileContext}`
          })
        },
        {
          name: 'anthropic',
          run: () => runAnthropic({
            apiKey: resolveKey('anthropic', userApiKeys),
            system: 'You are an expert software architect.',
            prompt: `Deconstruct the architecture of this specific repository in extreme detail. 
1. Write a deep-dive architecture reasoning section explaining module interactions and advanced design patterns.
2. Include a "Data Flow & State Transitions" Markdown TABLE with columns: Origin, Action, Logic Handler, and Resulting State.
CRITICAL: You MUST include the header separator line (e.g., | Origin | Action | Handler | Result |\n|---|---|---|---|).
3. Generate a high-detail Mermaid.js diagram (graph TD). 

CRITICAL: In the Mermaid diagram, NODE IDs MUST be simple alphanumeric strings (e.g., A, B, C, file1). NEVER use file paths, slashes, or parentheses in Node IDs. Put the descriptive names or file paths in the node labels only, like this: A["app/page.tsx"] --> B["lib/utils.ts"].

FILE TREE:
${fileTree}

FILES:
${fileContext}`
          })
        },
        {
          name: 'mistral',
          run: () => runMistral({
            apiKey: resolveKey('mistral', userApiKeys),
            system: 'You are an expert software architect.',
            prompt: `Deconstruct the architecture of this specific repository in extreme detail. 
1. Write a deep-dive architecture reasoning section explaining module interactions and advanced design patterns.
2. Include a "Data Flow & State Transitions" Markdown TABLE with columns: Origin, Action, Logic Handler, and Resulting State.
CRITICAL: You MUST include the header separator line (e.g., | Origin | Action | Handler | Result |\n|---|---|---|---|).
3. Generate a high-detail Mermaid.js diagram (graph TD). 
   - USE SUBGRAPHS to logically group components.

CRITICAL: In the Mermaid diagram, NODE IDs MUST be simple alphanumeric strings (e.g., A, B, C, file1). NEVER use file paths, slashes, or parentheses in Node IDs. Put the descriptive names or file paths in the node labels only, like this: A["app/page.tsx"] --> B["lib/utils.ts"].

FILE TREE:
${fileTree}

KEY SOURCE FILES:
${fileContext}`
          })
        }
      ];

      for (const p of providers) {
        if (!resolveKey(p.name, userApiKeys)) continue;
        try {
          const text = await p.run();
          
          // 1. Try to find content inside triple backticks
          const backtickMatch = text.match(/```mermaid\s*([\s\S]*?)```/i);
          let extractedMermaid = backtickMatch ? backtickMatch[1].trim() : '';

          // 2. If no backticks, try to find the start of a mermaid block
          if (!extractedMermaid) {
            const startMatch = text.match(/(?:graph (?:TD|LR|TB|BT)|pie|journey|sequenceDiagram|gantt|classDiagram|stateDiagram-v2|erDiagram)[\s\S]*$/i);
            if (startMatch) {
              extractedMermaid = startMatch[0].split(/\n#{1,3}\s/)[0].trim();
            }
          }
          
          // Clean up prefixes
          extractedMermaid = extractedMermaid.replace(/^mermaid\s+/i, '').trim();

          // Repair common AI diagram breakage (bad node ids, unquoted labels,
          // markdown junk) so the rendered diagram does not throw parse errors.
          extractedMermaid = sanitizeMermaidDiagram(extractedMermaid);
          
          // Ensure the reasoning doesn't contain the raw diagram
          let architectureReasoning = text;
          if (extractedMermaid) {
            architectureReasoning = text
              .replace(/```mermaid[\s\S]*?```/gi, '')
              .replace(extractedMermaid, '')
              .trim();
          }

          // Advanced table fixer: ensure tables have double newlines AND are trimmed
          architectureReasoning = architectureReasoning
            .replace(/([^\n])\r?\n\|/g, '$1\n\n|')
            .replace(/\|\r?\n([^\n])/g, '|\n\n$1')
            .replace(/\|\s+\n/g, '|\n');
          
          return JSON.stringify({ architectureReasoning, mermaidDiagram: extractedMermaid });
        } catch (e) {
          console.error(`[AI:Architecture] ${p.name} failed:`, e);
        }
      }
      return runLocalAnalysis({ type: 'architecture', fileTree, keyFiles });
    }
  ];

  const results = await Promise.allSettled(subtasks.map(t => t()));

  const getVal = (idx: number) => {
    const res = results[idx];
    return res.status === 'fulfilled' ? res.value : '[Generation failed for this section]';
  };

  const overview = getVal(0);
  const structureExplanation = getVal(1);
  const functionBreakdowns = getVal(2);
  
  let architectureReasoning = '[Reasoning failed]';
  let mermaidDiagram = '';
  try {
    const archVal = getVal(3);
    if (archVal.startsWith('{')) {
      const archResult = JSON.parse(archVal);
      architectureReasoning = archResult.architectureReasoning || '[No reasoning provided]';
      mermaidDiagram = archResult.mermaidDiagram || '';
    } else {
      architectureReasoning = archVal;
    }
  } catch (e) {
    console.error('[AI:ArchParse] Failed to parse architecture result:', e);
    architectureReasoning = getVal(3);
  }

  const fullMarkdown = `# Project Documentation

## 🚀 1. Overview
${overview}

---

## 📂 2. Project Structure
${structureExplanation}

---

## 🏗️ 3. Architecture & Data Flow
${architectureReasoning}

${mermaidDiagram ? `### 📈 System Architecture Diagram\n\n\`\`\`mermaid\n${mermaidDiagram}\n\`\`\`\n` : ''}

---

## 🛠️ 4. Function Breakdowns
${functionBreakdowns}
`;

  return {
    overview,
    structureExplanation,
    functionBreakdowns,
    mermaidDiagram,
    fullMarkdown,
  };
}
