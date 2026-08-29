/**
 * Shared RAG vector and metadata primitives.
 */

export function vectorLiteral(embedding) {
  if (!Array.isArray(embedding) || !embedding.length || !embedding.every(Number.isFinite)) {
    throw new TypeError('embedding required');
  }
  return `[${embedding.join(',')}]`;
}

export async function contentHash(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function sanitizeMetadata(metadata, maxValueChars = 2000) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    out[key] = JSON.stringify(value).slice(0, maxValueChars);
  }
  return out;
}
