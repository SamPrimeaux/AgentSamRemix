/** Coerce API/KV values to a single-line UI label (never render raw objects). */
export function coalesceLabel(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    const t = value.trim();
    return t || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const key of ['repo_full_name', 'full_name', 'remote', 'name', 'label', 'slug', 'id']) {
      const inner = coalesceLabel(o[key], '');
      if (inner) return inner;
    }
  }
  return fallback;
}
