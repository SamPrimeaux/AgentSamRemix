/** Portable Shopify/theme template planning. */
function textFromBytes(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * @param {Array<{ path: string, content: Uint8Array }>} entries
 * @param {string} templateName
 */
export function findThemeTemplateEntry(entries, templateName = 'index') {
  const target = `templates/${templateName}.json`.toLowerCase();
  for (const e of entries) {
    const p = String(e.path || '').replace(/\\/g, '/').toLowerCase();
    if (p === target || p.endsWith(`/${target}`)) return e;
  }
  return null;
}

/**
 * @param {string} text
 */
export function parseShopifyTemplateJson(text) {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return null;
    const sections = data.sections && typeof data.sections === 'object' ? data.sections : {};
    const order = Array.isArray(data.order)
      ? data.order.map((k) => String(k))
      : Object.keys(sections);
    const resolved = [];
    for (const key of order) {
      const block = sections[key];
      if (!block || typeof block !== 'object') continue;
      resolved.push({
        instance_key: key,
        section_type: String(block.type || key),
        settings: block.settings && typeof block.settings === 'object' ? block.settings : {},
      });
    }
    return { order: resolved, layout: data.layout || null };
  } catch {
    return null;
  }
}

/**
 * @param {Array<{ section_key: string, liquid_source?: string }>} liquidSections
 * @param {Array<{ instance_key: string, section_type: string, settings: Record<string, unknown> }>|null} templateOrder
 */
export function resolveThemeSectionPlan(liquidSections, templateOrder) {
  const byType = new Map();
  for (const sec of liquidSections || []) {
    const key = String(sec.section_key || '').trim();
    if (!key) continue;
    if (!byType.has(key)) byType.set(key, sec);
  }

  if (templateOrder?.length) {
    return templateOrder.map((row, i) => ({
      instance_key: row.instance_key,
      section_type: row.section_type,
      section_key: row.section_type,
      sort_order: (i + 1) * 10,
      settings: row.settings,
      liquid: byType.get(row.section_type) || null,
    }));
  }

  return (liquidSections || []).map((sec, i) => ({
    instance_key: sec.section_key,
    section_type: sec.section_key,
    section_key: sec.section_key,
    sort_order: (i + 1) * 10,
    settings: {},
    liquid: sec,
  }));
}
