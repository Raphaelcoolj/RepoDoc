const MERMAID_KEYWORD =
  /^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram(-v2)?|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|sankey-beta|block-beta|xychart-beta|packet-beta|kanban|arch|radar)\b/;

const DIAGRAM_TYPES = new Set([
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'erDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'gantt',
  'pie',
  'journey',
  'gitGraph',
  'mindmap',
  'timeline',
  'quadrantChart',
  'requirementDiagram',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'sankey-beta',
  'block-beta',
  'xychart-beta',
  'packet-beta',
  'kanban',
  'arch',
  'radar',
]);

const FLOWCHART_TYPES = new Set(['graph', 'flowchart']);

const ARROW_TOKEN =
  /^(-->|---|-\.-|-\.|==>|==|-\.->|--|o--|x--|<--|--\>|<\|--|~~~|===)$/;

const DIRECTIVE_LINE =
  /^(style|classDef|class|linkStyle|click|direction|accTitle|accDescr|title|acc_title|acc_descr)\b/;

const JUNK_LINE = /^(#{1,6}\s|```|\|.*\||[-*]\s+\S|\*\*\w)/;

const ID_SAFE = /^[A-Za-z0-9_]+$/;
const SHAPE_TOKEN =
  /^([A-Za-z0-9_]+)(\[\[.*\]\]|\(\(.*\)\)|\[\(.*\)\]|\{\{.*\}\}|\[.*\]|\(.*\)|\{.*\})$/;

function quoteInner(shape: string): string {
  const open = shape[0];
  const close = shape[shape.length - 1];
  const inner = shape.slice(1, -1);
  if (inner.startsWith('"') && inner.endsWith('"')) return shape;
  const escaped = inner.replace(/"/g, '&quot;');
  return `${open}"${escaped}"${close}`;
}

function labelHasSpecial(inner: string): boolean {
  return /[[\](){}#;|"'<>,=]/.test(inner) || /[^\x00-\x7F]/.test(inner);
}

/** Split on whitespace only at top level (not inside [], (), {}, "" or ||). */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  let inQuote = false;
  let inPipe = false;
  for (const ch of s) {
    if (ch === '"' && !inPipe) {
      inQuote = !inQuote;
      cur += ch;
      continue;
    }
    if (!inQuote && ch === '|') {
      inPipe = !inPipe;
      cur += ch;
      continue;
    }
    if (!inQuote && !inPipe) {
      if (ch === '[' || ch === '(' || ch === '{') depth += 1;
      else if (ch === ']' || ch === ')' || ch === '}') depth = Math.max(0, depth - 1);
      else if (depth === 0 && /\s/.test(ch)) {
        if (cur !== '') parts.push(cur);
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur !== '') parts.push(cur);
  return parts;
}

function quoteEdgeLabel(label: string): string {
  // label looks like |content|
  const content = label.slice(1, -1);
  if (content.startsWith('"') && content.endsWith('"')) return label;
  if (!labelHasSpecial(content)) return label;
  return `|"${content.replace(/"/g, '&quot;')}"|`;
}

function repairToken(
  token: string,
  nodeId: (orig?: string) => string
): string {
  const m = token.match(SHAPE_TOKEN);
  if (m) {
    const [, id, shape] = m;
    if (!ID_SAFE.test(id)) {
      // e.g. src/app/rooms/[id]/page.tsx  — id prefix itself is bogus
      return `${nodeId(token)}["${token.replace(/"/g, '&quot;')}"]`;
    }
    const inner = shape.slice(1, -1);
    const doubled =
      (shape.startsWith('[[') && shape.endsWith(']]')) ||
      (shape.startsWith('((') && shape.endsWith('))')) ||
      (shape.startsWith('{{') && shape.endsWith('}}'));
    const bare = doubled ? inner.slice(1, -1) : inner;
    if (labelHasSpecial(bare) && !(bare.startsWith('"') && bare.endsWith('"'))) {
      if (doubled) {
        return `${id}${shape.slice(0, 2)}"${bare.replace(/"/g, '&quot;')}"${shape.slice(-2)}`;
      }
      return id + quoteInner(shape);
    }
    return token;
  }
  if (/[()[\]{}#;|"'<>,=]/.test(token) || /[^\x00-\x7F]/.test(token)) {
    return `${nodeId(token)}["${token.replace(/"/g, '&quot;')}"]`;
  }
  return token;
}

function isArrow(tok: string): boolean {
  return ARROW_TOKEN.test(tok);
}

/** Soft links (--, -., ==) may be followed by label text then a hard arrow. */
const SOFT_ARROW = /^(--|-\.|==)$/;

function repairFlowchartLine(
  line: string,
  nodeId: (orig?: string) => string
): string {
  const trimmed = line.trim();
  if (!trimmed) return line;
  if (DIRECTIVE_LINE.test(trimmed)) return line;
  if (trimmed === 'end' || trimmed === 'subgraph' || trimmed.startsWith('subgraph ')) {
    return line;
  }

  const parts = splitTopLevel(trimmed);
  const out: string[] = [];
  let prev: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    const token = parts[i];

    // Arrow glued to its edge label: -->|label|
    const glued = token.match(/^(-->|---|-\.-|==>|==|--|o--|x--|<--)(\|.*\|)$/);
    if (glued) {
      out.push(glued[1], quoteEdgeLabel(glued[2]));
      prev = glued[2];
      continue;
    }

    if (isArrow(token)) {
      out.push(token);
      prev = token;
      continue;
    }

    if (/^\|.*\|$/.test(token)) {
      out.push(quoteEdgeLabel(token));
      prev = token;
      continue;
    }

    const softThenHard =
      SOFT_ARROW.test(prev ?? '') &&
      parts[i + 1] !== undefined &&
      isArrow(parts[i + 1]);
    if (softThenHard) {
      // label text between a soft link and its closing arrow
      out.push(token);
      prev = token;
      continue;
    }

    const nodePos = prev === undefined || isArrow(prev) || /^\|.*\|$/.test(prev);
    if (nodePos) {
      out.push(repairToken(token, nodeId));
    } else {
      out.push(token);
    }
    prev = token;
  }

  return out.join(' ');
}

function isFlowchart(body: string): boolean {
  const first = body.split(/\r?\n/).find((l) => l.trim() !== '' && !l.trimStart().startsWith('%%'));
  if (!first) return false;
  const kw = first.trim().split(/[\s\[]/)[0];
  return FLOWCHART_TYPES.has(kw);
}

/**
 * Best-effort repair of AI-generated Mermaid source so it parses under
 * mermaid v11. Returns '' when no diagram keyword can be found.
 */
export function sanitizeMermaidDiagram(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(/\r\n?/g, '\n');

  const fence = text.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1];

  const lines = text.split('\n');

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('%%')) continue;
    if (MERMAID_KEYWORD.test(t)) {
      start = i;
      break;
    }
  }
  if (start === -1) return '';

  const body: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '') {
      body.push('');
      continue;
    }
    if (t.startsWith('%%')) continue;
    if (t.startsWith('#') || t.startsWith('```')) break;
    if (JUNK_LINE.test(t)) continue;
    body.push(lines[i]);
  }

  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();

  const joined = body.join('\n').trim();
  if (joined === '') return '';
  if (!MERMAID_KEYWORD.test(joined)) return '';

  if (!isFlowchart(joined)) {
    return joined;
  }

  let counter = 0;
  const ids = new Map<string, string>();
  const nodeId = (orig?: string): string => {
    if (orig && ids.has(orig)) return ids.get(orig)!;
    const id = `m${++counter}`;
    if (orig) ids.set(orig, id);
    return id;
  };

  const repaired = joined
    .split('\n')
    .map((l) => repairFlowchartLine(l, nodeId))
    .join('\n');

  return repaired;
}
