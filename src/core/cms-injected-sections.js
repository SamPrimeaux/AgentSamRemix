/**
 * R2-backed HTML section injection for CMS pages.
 * Loads section artifacts from R2 (section_data.r2_key) and splices them into static shells.
 */

/** @param {string} html */
export function isFullHtmlDocument(html) {
  const raw = String(html || '').trim();
  if (!raw) return false;
  if (/^<!doctype\s/i.test(raw)) return true;
  return /<html[\s>]/i.test(raw);
}

/** @param {string} html */
export function normalizeFullPageHtml(html) {
  const raw = String(html || '').trim();
  if (!raw) return '';
  if (/^<!doctype\s/i.test(raw)) return raw;
  return `<!DOCTYPE html>\n${raw}`;
}

function slugSegment(value, fallback = 'section') {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}

/** @param {string} rawHtml */
export function extractInjectableHtml(rawHtml) {
  const raw = String(rawHtml || '').trim();
  if (!raw) return '';

  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();

  const htmlMatch = raw.match(/<html[^>]*>([\s\S]*?)<\/html>/i);
  if (htmlMatch) {
    const inner = htmlMatch[1];
    const nestedBody = inner.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (nestedBody) return nestedBody[1].trim();
    return inner.replace(/<head[^>]*>[\s\S]*?<\/head>/i, '').trim();
  }

  return raw;
}

/** @param {Record<string, unknown>} sectionData */
export function resolveSectionR2Key(sectionData) {
  const data = sectionData && typeof sectionData === 'object' ? sectionData : {};
  const direct = String(data.r2_key || data.r2Key || '').trim();
  if (direct) return direct;
  const artifact =
    data.template_artifact && typeof data.template_artifact === 'object'
      ? data.template_artifact
      : null;
  if (artifact?.r2_key) return String(artifact.r2_key).trim();
  return '';
}

/** @param {Record<string, unknown>} section */
export function sectionInjectionKeys(section) {
  const keys = new Set();
  const name = String(section.section_name || '').trim();
  const type = String(section.section_type || '').trim();
  const id = String(section.id || '').trim();
  if (name) {
    keys.add(name);
    keys.add(slugSegment(name));
  }
  if (type) {
    keys.add(type);
    keys.add(slugSegment(type));
  }
  if (id) keys.add(id);
  return [...keys].filter(Boolean);
}

/**
 * @param {unknown} r2Binding
 * @param {string} r2Key
 */
export async function fetchInjectedSectionHtml(r2Binding, r2Key) {
  if (!r2Binding || !r2Key) return null;
  const obj = await r2Binding.get(String(r2Key)).catch(() => null);
  if (!obj) return null;
  const raw = await obj.text();
  return extractInjectableHtml(raw);
}

/**
 * Replace or append injected section HTML into a page shell.
 * @param {string} html
 * @param {Array<Record<string, unknown>>} sections
 * @param {unknown} r2Binding
 */
export async function hydratePageWithInjectedSections(html, sections, r2Binding) {
  let out = String(html || '');
  const visible = (sections || []).filter((s) => s.is_visible === 1 || s.is_visible === true);
  const sorted = [...visible].sort(
    (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0),
  );

  for (const section of sorted) {
    const data =
      section.section_data && typeof section.section_data === 'object'
        ? section.section_data
        : (() => {
            try {
              return typeof section.section_data === 'string'
                ? JSON.parse(section.section_data)
                : {};
            } catch {
              return {};
            }
          })();

    const r2Key = resolveSectionR2Key(data);
    if (!r2Key && data.html_source !== 'injected') continue;

    const injected = r2Key ? await fetchInjectedSectionHtml(r2Binding, r2Key) : '';
    if (!injected?.trim()) continue;

    const keys = sectionInjectionKeys(section);
    let replaced = false;

    for (const key of keys) {
      const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Include header/footer — ZONE_HTML_STARTERS and chrome blocks use those tags.
      const sectionRe = new RegExp(
        `(<(?:section|div|article|header|footer|main)[^>]*\\sdata-cms-section="${safe}"[^>]*>)([\\s\\S]*?)(</(?:section|div|article|header|footer|main)>)`,
        'i',
      );
      if (sectionRe.test(out)) {
        out = out.replace(sectionRe, `$1${injected}$3`);
        replaced = true;
        break;
      }
      const idRe = new RegExp(
        `(<(?:section|div|article|header|footer|main)[^>]*\\sid="${safe}"[^>]*>)([\\s\\S]*?)(</(?:section|div|article|header|footer|main)>)`,
        'i',
      );
      if (idRe.test(out)) {
        out = out.replace(idRe, `$1${injected}$3`);
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      const marker = `<!-- cms-inject:${slugSegment(section.section_name || section.section_type)} -->`;
      if (out.includes(marker)) {
        out = out.replace(marker, `${marker}\n${injected}`);
        replaced = true;
      }
    }

    if (!replaced) {
      const pos = String(data.inject_position || data.position || '').trim();
      if (pos === 'start') {
        out = out.replace(/<body[^>]*>/i, (m) => `${m}\n${injected}`);
      } else {
        out = out.replace(/<\/body>/i, `${injected}\n</body>`);
      }
    }
  }

  return out;
}

/**
 * Async preview renderer — embeds R2 HTML for injected sections.
 * @param {Array<Record<string, unknown>>} sections
 * @param {Record<string, Array<Record<string, unknown>>>} componentsBySection
 * @param {unknown} r2Binding
 * @param {{ themeCss?: string }} [opts]
 */
export async function renderCmsSectionTreeHtmlWithInjections(
  sections,
  componentsBySection = {},
  r2Binding,
  opts = {},
) {
  const sorted = [...(sections || [])].sort(
    (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0),
  );
  const themeCss = String(opts.themeCss || '').trim();
  const parts = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>CMS Preview</title>',
    themeCss ? `<style id="cms-theme">${themeCss}</style>` : '',
    '<style>body{font-family:system-ui,sans-serif;margin:0;padding:0;background:#0a0a0a;color:#e5e5e5}',
    'section{margin-bottom:0}.hidden{display:none!important}',
    '.cms-injected-wrap{border-bottom:1px solid rgba(255,255,255,.08)}',
    'h1,h2{margin:0 0 8px}p{margin:0 0 8px;line-height:1.5}',
    '.cmp{margin-top:8px;padding:8px;background:#111;border-radius:6px;font-size:14px}</style></head><body>',
  ];

  for (const s of sorted) {
    const hidden = !(s.is_visible === 1 || s.is_visible === true);
    const data =
      s.section_data && typeof s.section_data === 'object'
        ? s.section_data
        : (() => {
            try {
              return typeof s.section_data === 'string' ? JSON.parse(s.section_data) : {};
            } catch {
              return {};
            }
          })();

    const r2Key = resolveSectionR2Key(data);
    const isInjected = data.html_source === 'injected' || Boolean(r2Key);

    if (isInjected && r2Key && r2Binding) {
      const injected = await fetchInjectedSectionHtml(r2Binding, r2Key);
      if (injected?.trim()) {
        parts.push(
          `<div class="cms-injected-wrap${hidden ? ' hidden' : ''}" data-section="${s.id}" data-cms-section="${slugSegment(s.section_name || s.section_type)}" data-section-key="${slugSegment(s.section_name || s.section_type || s.id)}">`,
          injected,
          '</div>',
        );
        continue;
      }
    }

    parts.push(`<section class="${hidden ? 'hidden' : ''}" data-section="${s.id}">`);
    const headline = data.headline || data.heading || data.title || s.section_name || s.section_type;
    if (headline) parts.push(`<h2>${escapeHtml(String(headline))}</h2>`);
    const body = data.body || data.paragraph || data.description || data.subheadline || '';
    if (body) parts.push(`<p>${escapeHtml(String(body))}</p>`);
    const comps = componentsBySection[s.id] || [];
    for (const c of comps) {
      const cd =
        c.component_data && typeof c.component_data === 'object'
          ? c.component_data
          : (() => {
              try {
                return typeof c.component_data === 'string' ? JSON.parse(c.component_data) : {};
              } catch {
                return {};
              }
            })();
      const label = cd.label || cd.title || c.component_type || 'component';
      parts.push(`<div class="cmp" data-component="${c.id}">${escapeHtml(String(label))}</div>`);
    }
    parts.push('</section>');
  }

  parts.push('</body></html>');
  return parts.join('');
}

/** @param {string} s */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
