function clean(value, max = 2000) {
  return value == null ? null : String(value).slice(0, max);
}

export function normalizeArtifactReceipt(input) {
  if (!input || typeof input !== 'object') return null;
  const ref = {
    id: clean(input.id || input.artifact_id || crypto.randomUUID(), 160),
    kind: clean(input.kind || input.type || 'artifact', 80),
    name: clean(input.name || input.filename || null, 300),
    uri: clean(input.uri || input.url || input.object_key || input.path || null, 2000),
    content_type: clean(input.content_type || input.mime_type || null, 160),
    size_bytes: Number.isFinite(Number(input.size_bytes)) ? Number(input.size_bytes) : null,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : null,
  };
  return ref.uri || ref.name ? ref : null;
}

export function normalizeArtifactReceipts(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeArtifactReceipt).filter(Boolean).slice(0, 100);
}
