import { sanitizeMermaidDiagram } from '@/lib/mermaid';

describe('sanitizeMermaidDiagram', () => {
  it('returns empty when no diagram keyword exists', () => {
    expect(sanitizeMermaidDiagram('just some prose')).toBe('');
    expect(sanitizeMermaidDiagram('')).toBe('');
  });

  it('keeps a valid diagram untouched', () => {
    const src = 'graph TD\n  A["app/page.tsx"] --> B["lib/db.ts"]';
    expect(sanitizeMermaidDiagram(src)).toBe(src);
  });

  it('rewrites bare node ids containing brackets to safe ids with labels', () => {
    const out = sanitizeMermaidDiagram(
      'graph TD\n  src/app/api/auth/[...nextauth]/route.ts --> auth.ts'
    );
    expect(out).toMatch(/^graph TD\nm1\["src\/app\/api\/auth\/\[\.\.\.nextauth\]\/route\.ts"\] --> auth\.ts$/);
  });

  it('keeps repeated unsafe ids stable across lines', () => {
    const out = sanitizeMermaidDiagram(
      'graph TD\n  src/app/[x]/a.ts --> b.ts\n  src/app/[x]/a.ts --> c.ts'
    );
    const ids = out.match(/m\d+\[/g) ?? [];
    expect(new Set(ids).size).toBe(1);
    expect(out.split('src/app/[x]/a.ts').length - 1).toBe(2);
  });

  it('quotes unquoted labels that contain brackets or parentheses', () => {
    expect(sanitizeMermaidDiagram('graph TD\n  A[src/app/rooms/[id]/page.tsx] --> B[x]')).toContain(
      'A["src/app/rooms/[id]/page.tsx"]'
    );
    expect(sanitizeMermaidDiagram('graph TD\n  A[Payment (Stripe) flow] --> B[x]')).toContain(
      'A["Payment (Stripe) flow"]'
    );
  });

  it('quotes edge labels containing brackets', () => {
    const out = sanitizeMermaidDiagram('graph TD\n  A -->|uses [id]| B');
    expect(out).toContain('|"uses [id]"|');
  });

  it('strips markdown junk (headings, tables, lists, bold) from the diagram', () => {
    const out = sanitizeMermaidDiagram(
      'graph TD\n  A --> B\n  ### Data Flow\n  | x | y |\n  - item\n  **note**\n  B --> C'
    );
    expect(out).toBe('graph TD\nA --> B\nB --> C');
  });

  it('extracts the diagram from a fenced block with surrounding prose', () => {
    const out = sanitizeMermaidDiagram(
      'Here:\n```mermaid\ngraph TD\n  A[x] --> B\n```\nDone.'
    );
    expect(out).toBe('graph TD\nA[x] --> B');
  });

  it('rewrites non-ascii node ids', () => {
    const out = sanitizeMermaidDiagram('graph TD\n  A🚀 --> B');
    expect(out).toContain('["A🚀"]');
    expect(out).not.toContain('A🚀 -->');
  });

  it('leaves non-flowchart diagrams structurally alone', () => {
    const src = 'sequenceDiagram\n  participant U as User\n  U->>S: submit';
    expect(sanitizeMermaidDiagram(src)).toBe(src);
  });

  it('does not touch directive lines', () => {
    const src = 'graph TD\n  A --> B\n  style A fill:#fff,stroke:#333';
    expect(sanitizeMermaidDiagram(src)).toBe(src);
  });
});
