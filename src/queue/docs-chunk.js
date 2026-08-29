/** Chunk plain text with fixed window/overlap (ported from worker.js codebase reindex). */
export function chunkTextForCodebaseReindex(text, size, overlap) {
  const chunks = [];
  if (!text || !text.length) return chunks;
  const step = Math.max(1, size - overlap);
  for (let i = 0; i < text.length; i += step) {
    chunks.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return chunks;
}
