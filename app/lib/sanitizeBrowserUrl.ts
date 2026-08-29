/** Strip JSON tails from navigate URLs (e.g. `...docs","source":"workflow_graph_node_start"}}`). */
export function sanitizeBrowserNavigateUrl(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = s.match(/https?:\/\/[^\s"'<>\])},]+/i);
  return m ? m[0].replace(/[.,;)\]]+$/, '') : '';
}
