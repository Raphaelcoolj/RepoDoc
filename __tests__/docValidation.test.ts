import { validateGeneratedDoc } from '../lib/docValidation';

function validMarkdown(): string {
  return [
    '# Project Documentation',
    '',
    '## 🚀 1. Overview',
    '',
    'This repository generates documentation from source. '.repeat(6),
    '',
    '## 📂 2. Project Structure',
    '',
    '```',
    'src/',
    '  index.ts',
    '  lib/',
    '```',
    '',
    '## 🏗️ 3. Architecture & Data Flow',
    '',
    'A pipeline ingests the repository, extracts structure, and renders markdown. '.repeat(4),
    '',
    '## 🛠️ 4. Function Breakdowns',
    '',
    '| Function | Purpose |',
    '| --- | --- |',
    '| generate | runs the pipeline |'.repeat(3),
    '',
  ].join('\n');
}

const VALID_MERMAID = 'graph TD\n  A[Repo] --> B[Doc]';

describe('validateGeneratedDoc', () => {
  it('accepts a well-formed document', () => {
    const result = validateGeneratedDoc(validMarkdown(), VALID_MERMAID);
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it('accepts an empty mermaid diagram', () => {
    const result = validateGeneratedDoc(validMarkdown(), '');
    expect(result.ok).toBe(true);
  });

  it('rejects a generation failure marker', () => {
    const md = `${validMarkdown()}\n[Generation failed for this section]`;
    const result = validateGeneratedDoc(md, '');
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('markdown contains a generation failure marker');
  });

  it.each<[string, RegExp, string]>([
    ['title', /^#\s+Project Documentation/m, '# Other Title'],
    ['overview', /^##\s+.*\b1\.\s*Overview/m, '## 🚀 1. Introduction'],
    ['structure', /^##\s+.*\b2\.\s*Project Structure/m, '## 📂 2. Layout'],
    ['architecture', /^##\s+.*\b3\.\s*Architecture/m, '## 🏗️ 3. Design'],
    ['functions', /^##\s+.*\b4\.\s*Function Breakdowns/m, '## 🛠️ 4. API'],
  ])('rejects a missing required section: %s', (name, pattern, replacement) => {
    const md = validMarkdown().replace(pattern, replacement);
    const result = validateGeneratedDoc(md, '');
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(`missing required section: ${name}`);
  });

  it('rejects markdown below the minimum length', () => {
    const short = [
      '# Project Documentation',
      '## 🚀 1. Overview',
      '## 📂 2. Project Structure',
      '## 🏗️ 3. Architecture & Data Flow',
      '## 🛠️ 4. Function Breakdowns',
    ].join('\n\n');
    const result = validateGeneratedDoc(short, '');
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(
      'markdown is too short (min 500 characters)'
    );
  });

  it('rejects an unclosed code fence', () => {
    const md = `${validMarkdown()}\n\`\`\`ts\nconst x = 1;\n`;
    const result = validateGeneratedDoc(md, '');
    expect(result.ok).toBe(false);
    expect(
      result.reasons.some((r) => r.startsWith('unclosed code fence'))
    ).toBe(true);
  });

  it('rejects a nested code fence', () => {
    const md = [
      validMarkdown(),
      '```',
      'outer',
      '```js',
      'inner',
      '```',
      '```',
    ].join('\n');
    const result = validateGeneratedDoc(md, '');
    expect(result.ok).toBe(false);
    expect(
      result.reasons.some((r) => r.startsWith('nested or malformed code fence'))
    ).toBe(true);
  });

  it('rejects a mermaid diagram with an invalid keyword', () => {
    const result = validateGeneratedDoc(validMarkdown(), 'not a diagram');
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(
      'mermaid diagram does not begin with a valid diagram keyword'
    );
  });

  it('accepts common mermaid diagram types', () => {
    for (const diagram of [
      'graph TD\n  A --> B',
      'flowchart LR\n  A --> B',
      'sequenceDiagram\n  A->>B: hi',
      'classDiagram\n  A <|-- B',
      'erDiagram\n  A ||--o{ B : has',
      'erDiagram\n  A ||--o{ B : has\n  A {\n    string name\n  }',
      'stateDiagram-v2\n  [*] --> S',
    ]) {
      expect(validateGeneratedDoc(validMarkdown(), diagram)).toEqual({
        ok: true,
        reasons: [],
      });
    }
  });

  it('rejects unbalanced brackets in mermaid', () => {
    const result = validateGeneratedDoc(validMarkdown(), 'graph TD\n  A[Start');
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(
      'unbalanced "[]" in mermaid diagram'
    );
  });

  it('ignores brackets inside quoted mermaid labels', () => {
    const diagram = 'graph TD\n  A["("] --> B[")"]';
    expect(validateGeneratedDoc(validMarkdown(), diagram).ok).toBe(true);
  });

  it('skips mermaid comment lines before the keyword', () => {
    const diagram = '%% a comment\ngraph TD\n  A --> B';
    expect(validateGeneratedDoc(validMarkdown(), diagram).ok).toBe(true);
  });
});
