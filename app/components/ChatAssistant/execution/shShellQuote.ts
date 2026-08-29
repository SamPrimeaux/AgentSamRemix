/**
 * POSIX single-quote for embedding paths in one-line shell commands.
 */
export function shellSingleQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\"'\"'`)}'`;
}
