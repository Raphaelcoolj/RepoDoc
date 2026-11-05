export function fixMarkdownTables(text: string): string {
  return text
    .replace(/([^\n])\r?\n\|/g, '$1\n\n|')
    .replace(/\|\r?\n([^\n])/g, '|\n\n$1')
    .replace(/\|\s+\r?\n/g, '|\n');
}
