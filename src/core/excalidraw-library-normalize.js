/**
 * Normalize .excalidrawlib JSON (v1 library[][] or v2 libraryItems[]) → Excalidraw LibraryItem[].
 */

function isExcalidrawElement(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.type === 'string' &&
    typeof obj.id === 'string' &&
    !Array.isArray(obj)
  );
}

function isLibraryItem(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    Array.isArray(obj.elements) &&
    obj.elements.length > 0 &&
    isExcalidrawElement(obj.elements[0])
  );
}

/**
 * @param {unknown} raw parsed JSON from .excalidrawlib or API
 * @param {{ slug?: string, source?: string, itemNamePrefix?: string }} [opts]
 * @returns {Array<{ id: string, status: string, created: number, elements: unknown[], name?: string }>}
 */
export function normalizeExcalidrawLibraryPayload(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return [];
  const o = /** @type {Record<string, unknown>} */ (raw);

  const libraryItems = o.libraryItems;
  if (Array.isArray(libraryItems) && libraryItems.length > 0) {
    if (isLibraryItem(libraryItems[0])) {
      return libraryItems.map((item) => ({
        ...item,
        status: item.status === 'unpublished' ? 'unpublished' : 'published',
      }));
    }
  }

  const lib = o.library ?? o.items;
  if (!Array.isArray(lib) || lib.length === 0) return [];

  if (isLibraryItem(lib[0])) {
    return lib.map((item) => ({
      ...item,
      status: item.status === 'unpublished' ? 'unpublished' : 'published',
    }));
  }

  const prefix = String(opts.slug || opts.source || 'iam')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);

  // v1: array of element groups
  if (Array.isArray(lib[0])) {
    /** @type {Array<{ id: string, status: string, created: number, elements: unknown[], name?: string }>} */
    const out = [];
    for (let idx = 0; idx < lib.length; idx++) {
      const group = lib[idx];
      if (!Array.isArray(group)) continue;
      const elements = group.filter(isExcalidrawElement);
      if (!elements.length) continue;
      const firstId = String(elements[0]?.id || idx);
      out.push({
        id: `${prefix}_g${idx}_${firstId.slice(0, 12)}`,
        status: 'published',
        created: Date.now() + idx,
        elements,
        ...(opts.itemNamePrefix ? { name: `${opts.itemNamePrefix} ${idx + 1}` } : {}),
      });
    }
    return out;
  }

  // flat element list → single library item
  if (isExcalidrawElement(lib[0])) {
    const elements = lib.filter(isExcalidrawElement);
    if (!elements.length) return [];
    return [
      {
        id: `${prefix}_flat`,
        status: 'published',
        created: Date.now(),
        elements,
      },
    ];
  }

  return [];
}
