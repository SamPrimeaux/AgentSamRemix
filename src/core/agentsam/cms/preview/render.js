/**
 * Single CMS preview/public HTML fallback for registered section payloads.
 * Field keys come from the portable registry (hero: eyebrow/heading/body/…).
 */

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ctaLabel(cta) {
  if (cta == null) return '';
  if (typeof cta === 'string') return cta;
  if (typeof cta === 'object') return String(cta.label || cta.text || cta.href || '');
  return '';
}

function ctaHref(cta) {
  if (cta == null || typeof cta !== 'object') return '#';
  return String(cta.href || '#');
}

function assetUrl(asset) {
  if (asset == null) return '';
  if (typeof asset === 'string') return asset;
  if (typeof asset === 'object') return String(asset.url || asset.src || asset.href || '');
  return '';
}

/**
 * Render one registered section type from registry-shaped data.
 * Used by editor canvas, preview fallback, and public hydrate — not a second stack.
 *
 * @param {string} type
 * @param {Record<string, unknown>} data
 * @param {{ id?: string, name?: string, visible?: boolean }} [meta]
 */
export function renderCmsRegisteredSectionHtml(type, data = {}, meta = {}) {
  const t = String(type || '').trim().toLowerCase();
  const d = data && typeof data === 'object' ? data : {};
  const id = escapeHtml(meta.id || '');
  const hidden = meta.visible === false ? ' class="hidden"' : '';
  const dataAttrs = id
    ? ` data-section="${id}" data-cms-id="${id}" data-section-type="${escapeHtml(t)}"`
    : ` data-section-type="${escapeHtml(t)}"`;

  if (t === 'hero') {
    const eyebrow = d.eyebrow != null ? String(d.eyebrow) : '';
    const heading = String(d.heading || d.headline || d.title || meta.name || 'Hero');
    const body = String(d.body || d.description || '');
    const image = assetUrl(d.image);
    const primary = d.primaryCta;
    const bg = image
      ? ` style="background-image:linear-gradient(90deg,rgba(7,7,10,.78),rgba(7,7,10,.2)),url('${escapeHtml(image)}')"`
      : '';
    const parts = [`<section${hidden}${dataAttrs} class="cms-hero"${bg}><div class="cms-hero-inner">`];
    if (eyebrow) parts.push(`<p class="cms-eyebrow">${escapeHtml(eyebrow)}</p>`);
    parts.push(`<h1>${escapeHtml(heading)}</h1>`);
    if (body) parts.push(`<p class="cms-body">${escapeHtml(body)}</p>`);
    const label = ctaLabel(primary);
    if (label) {
      parts.push(`<a class="cms-cta" href="${escapeHtml(ctaHref(primary))}">${escapeHtml(label)}</a>`);
    }
    parts.push('</div></section>');
    return parts.join('');
  }

  // Generic registered / legacy payload — same headline/body resolution as before.
  const headline = d.headline || d.heading || d.title || meta.name || type;
  const body = d.body || d.paragraph || d.description || d.subheadline || '';
  const parts = [`<section${hidden}${dataAttrs}>`];
  if (headline) parts.push(`<h2>${escapeHtml(headline)}</h2>`);
  if (body) parts.push(`<p>${escapeHtml(body)}</p>`);
  parts.push('</section>');
  return parts.join('');
}

/**
 * Preview document from portable page model (sections[].type + sections[].data).
 */
export function renderCmsPreviewFallbackHtml(model, opts = {}) {
  const themeCss = String(opts.themeCss || '').trim();
  const parts = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>CMS Preview</title>',
    themeCss ? `<style id="cms-theme">${themeCss}</style>` : '',
    '<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#faf9f7;color:#1a1815}section{margin-bottom:32px;padding:20px;border:1px solid #e8e4dc;border-radius:10px}h1,h2{margin:0 0 8px}p{margin:0 0 8px;line-height:1.5;color:#444}.cms-hero{min-height:280px;display:flex;align-items:flex-end;background:#0c0c10;color:#fff;background-size:cover;background-position:center}.cms-hero-inner{max-width:40rem}.cms-eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:11px;opacity:.85}.cms-cta{display:inline-block;margin-top:12px;padding:10px 16px;border-radius:999px;background:#6358ff;color:#fff;text-decoration:none}.cmp{margin-top:8px;padding:8px;background:#fff;border-radius:6px;font-size:14px;color:#1a1815}.hidden{opacity:.35}</style></head><body>',
  ];
  for (const section of model?.sections || []) {
    let html = renderCmsRegisteredSectionHtml(section.type, section.data || {}, {
      id: section.id,
      name: section.name,
      visible: section.visible !== false,
    });
    const blocks = model.blocks_by_section?.[section.id] || [];
    if (blocks.length) {
      const blockHtml = blocks
        .map((block) => {
          const bd = block.data || {};
          const label = bd.label || bd.title || block.type || 'block';
          return `<div class="cmp" data-block="${escapeHtml(block.id)}" data-component="${escapeHtml(block.id)}">${escapeHtml(label)}</div>`;
        })
        .join('');
      html = html.replace(/<\/section>$/, `${blockHtml}</section>`);
    }
    parts.push(html);
  }
  parts.push('</body></html>');
  return parts.join('');
}

/**
 * Public/publish hydrate: same renderer over D1 section rows.
 * @param {Array<{ id?: string, section_type?: string, section_name?: string, section_data?: object, is_visible?: number|boolean }>} sections
 */
export function renderCmsPublishedSectionsHtml(sections, opts = {}) {
  const model = {
    sections: (sections || []).map((row) => ({
      id: row.id,
      type: row.section_type || row.type,
      name: row.section_name || row.name,
      data: row.section_data || row.data || {},
      visible: row.is_visible !== 0 && row.is_visible !== false && row.visible !== false,
    })),
    blocks_by_section: opts.blocks_by_section || {},
  };
  return renderCmsPreviewFallbackHtml(model, opts);
}
