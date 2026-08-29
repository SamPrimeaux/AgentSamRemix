const RAG_CHUNK_MAX_CHARS = 600;
const RAG_CHUNK_OVERLAP = 80;

/** Chunk markdown by headings then windows (from worker.js). */
export function chunkMarkdown(text, maxChars = RAG_CHUNK_MAX_CHARS, overlap = RAG_CHUNK_OVERLAP) {
  const chunks = [];
  const sections = text.split(/(?=^##?\s)/m).map((s) => s.trim()).filter(Boolean);
  for (const section of sections) {
    if (section.length <= maxChars) {
      chunks.push(section);
      continue;
    }
    let start = 0;
    while (start < section.length) {
      const end = Math.min(start + maxChars, section.length);
      let slice = section.slice(start, end);
      if (end < section.length && !/[\n.]$/.test(slice)) {
        const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
        if (lastBreak > maxChars / 2) slice = slice.slice(0, lastBreak + 1);
      }
      if (slice.trim()) chunks.push(slice.trim());
      start = end - (end < section.length ? overlap : 0);
    }
  }
  return chunks.length ? chunks : [text.slice(0, maxChars)];
}
