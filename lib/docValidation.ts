export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

const MIN_MARKDOWN_LENGTH = 500;
const FAILURE_MARKER = '[Generation failed for this section]';

const REQUIRED_SECTIONS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'title', pattern: /^#\s+Project Documentation/m },
  { name: 'overview', pattern: /^##\s+.*\b1\.\s*Overview/m },
  { name: 'structure', pattern: /^##\s+.*\b2\.\s*Project Structure/m },
  { name: 'architecture', pattern: /^##\s+.*\b3\.\s*Architecture/m },
  { name: 'functions', pattern: /^##\s+.*\b4\.\s*Function Breakdowns/m },
];

const MERMAID_KEYWORD =
  /^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram(-v2)?|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|sankey-beta|block-beta|xychart-beta|packet-beta|kanban|arch|radar)\b/;

function checkFences(markdown: string): string[] {
  const reasons: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let open = false;
  let openLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (!trimmed.startsWith('```')) continue;
    if (!open) {
      open = true;
      openLine = i + 1;
      continue;
    }
    const rest = trimmed.slice(3).trim();
    if (rest !== '') {
      reasons.push(`nested or malformed code fence at line ${i + 1}`);
    }
    open = false;
  }

  if (open) {
    reasons.push(`unclosed code fence opened at line ${openLine}`);
  }
  return reasons;
}

function stripQuoted(input: string): string {
  return input.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

// Crow's-foot cardinality symbols (erDiagram): "}o", "}|", "o{", "|{" are
// notation, not grouping brackets.
const ER_CARDINALITY = /\}[o|]|[o|]\{/g;

function checkBrackets(diagram: string): string[] {
  const reasons: string[] = [];
  const stripped = stripQuoted(diagram).replace(ER_CARDINALITY, '');
  const pairs: Array<[string, string]> = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ];
  for (const [open, close] of pairs) {
    let depth = 0;
    for (const ch of stripped) {
      if (ch === open) depth += 1;
      else if (ch === close) depth -= 1;
      if (depth < 0) break;
    }
    if (depth !== 0) {
      reasons.push(`unbalanced "${open}${close}" in mermaid diagram`);
    }
  }
  return reasons;
}

function checkMermaid(mermaid: string): string[] {
  const reasons: string[] = [];
  const body = mermaid
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('%%'))
    .join('\n')
    .trim();

  if (body === '') return reasons;
  if (!MERMAID_KEYWORD.test(body)) {
    reasons.push('mermaid diagram does not begin with a valid diagram keyword');
  }
  reasons.push(...checkBrackets(body));
  return reasons;
}

export function validateGeneratedDoc(
  markdown: string,
  mermaid: string
): ValidationResult {
  const reasons: string[] = [];

  if (markdown.includes(FAILURE_MARKER)) {
    reasons.push('markdown contains a generation failure marker');
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!section.pattern.test(markdown)) {
      reasons.push(`missing required section: ${section.name}`);
    }
  }

  if (markdown.trim().length < MIN_MARKDOWN_LENGTH) {
    reasons.push(`markdown is too short (min ${MIN_MARKDOWN_LENGTH} characters)`);
  }

  reasons.push(...checkFences(markdown));
  reasons.push(...checkMermaid(mermaid));

  return { ok: reasons.length === 0, reasons };
}
