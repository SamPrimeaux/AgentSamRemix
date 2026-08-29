import { assertCmsTemplateStore } from './contracts.js';

export async function listCmsTemplates(store, { category = null, limit = 5000 } = {}) {
  assertCmsTemplateStore(store);
  const rows = await store.list({ category, limit });
  return { ok: true, templates: rows, total: rows.length };
}

export async function getCmsTemplate(store, templateId) {
  assertCmsTemplateStore(store);
  const template = await store.getById(String(templateId || '').trim());
  return template ? { ok: true, template } : { ok: false, error: 'template_not_found', status: 404 };
}

export async function upsertCmsTemplate(store, input) {
  assertCmsTemplateStore(store);
  const templateName = String(input?.template_name || '').trim();
  if (!templateName) return { ok: false, error: 'template_name_required', status: 400 };
  const templateData = input.template_data ?? input.templateData ?? {};
  const template = {
    id: String(input.id || '').trim() || `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    template_name: templateName,
    template_type: String(input.template_type || 'section').trim(),
    category: String(input.category || 'General').trim(),
    is_system: input.is_system === true || input.is_system === 1 ? 1 : 0,
    slug: input.slug != null ? String(input.slug).trim() || null : null,
    r2_key: input.r2_key != null ? String(input.r2_key).trim() || null : null,
    source_html_r2_key: input.source_html_r2_key != null ? String(input.source_html_r2_key).trim() || null : null,
    template_data: typeof templateData === 'string' ? templateData : JSON.stringify(templateData || {}),
    preview_image_url: input.preview_image_url != null ? String(input.preview_image_url).trim() || null : null,
    source_liquid_file: input.source_liquid_file != null ? String(input.source_liquid_file).trim() || null : null,
  };
  await store.upsert(template);
  return { ok: true, template };
}

export async function patchCmsTemplate(store, templateId, input) {
  assertCmsTemplateStore(store);
  const current = await store.getById(String(templateId || '').trim());
  if (!current) return { ok: false, error: 'template_not_found', status: 404 };
  const patch = {};
  if (input?.iam_tags != null) patch.iam_tags = JSON.stringify(Array.isArray(input.iam_tags) ? input.iam_tags.map((t) => String(t).trim()).filter(Boolean) : []);
  for (const key of ['iam_build','iam_category','iam_label']) if (input?.[key] != null) patch[key] = String(input[key]).trim() || null;
  if (!Object.keys(patch).length) return { ok: false, error: 'no_fields_to_update', status: 400 };
  await store.patch(templateId, patch);
  return { ok: true, template: await store.getById(templateId) };
}
