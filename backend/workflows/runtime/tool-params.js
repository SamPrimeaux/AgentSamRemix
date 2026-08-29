/** Generic workflow tool parameter mapping. Tool-specific semantics belong to the tool domain. */
export function resolveWorkflowToolParams(config, paramRoot) {
  const merged = { ...paramRoot };
  const map = config?.input_map;
  if (!map || typeof map !== 'object') return merged;
  for (const [key, pathOrValue] of Object.entries(map)) {
    if (typeof pathOrValue === 'string' && pathOrValue.startsWith('$.')) {
      let cur = paramRoot;
      for (const part of pathOrValue.slice(2).split('.')) cur = cur?.[part];
      if (cur != null && cur !== '') merged[key] = cur;
    } else if (pathOrValue != null) {
      merged[key] = pathOrValue;
    }
  }
  return merged;
}
