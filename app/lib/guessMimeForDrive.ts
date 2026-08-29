/** MIME guess for Drive file save (Wave 2 E6). */
export function guessMimeForDrive(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    ts: 'text/typescript; charset=utf-8',
    tsx: 'text/typescript; charset=utf-8',
    jsx: 'text/javascript; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    svg: 'image/svg+xml',
    csv: 'text/csv; charset=utf-8',
  };
  return map[ext] || 'text/plain; charset=utf-8';
}
