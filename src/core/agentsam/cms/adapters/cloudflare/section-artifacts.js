import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from './storage.js';

function jsonObject(value) {
  if (value && typeof value === 'object') return value;
  try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch { return {}; }
}
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const cmsSectionDraftKey = (pageId, sectionId) => `cms/sections/drafts/${encodeURIComponent(String(pageId))}/${encodeURIComponent(String(sectionId))}.json`;
export const cmsSectionPublicationKey = (publicationId, sectionId) => `cms/sections/publications/${encodeURIComponent(String(publicationId))}/${encodeURIComponent(String(sectionId))}.json`;
export const cmsPageManifestKey = (publicationId) => `cms/pages/publications/${encodeURIComponent(String(publicationId))}/page.json`;
export const cmsPublishedRoutePointerKey = (routePath) => `cms:published:route:${String(routePath || '/').trim() || '/'}`;

export async function writeCmsSectionDraftArtifact(env, { pageId, sectionId, data, key = null }) {
  const binding = getCmsR2Binding(env, CMS_DEFAULT_R2_BUCKET);
  if (!binding) throw new Error('CMS R2 storage unavailable');
  const r2Key = key || cmsSectionDraftKey(pageId, sectionId);
  const body = JSON.stringify(jsonObject(data));
  const contentHash = await sha256(body);
  await binding.put(r2Key, body, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return { r2_key: r2Key, r2_bucket: CMS_DEFAULT_R2_BUCKET, content_hash: contentHash, byte_length: body.length };
}
export async function readCmsSectionArtifact(env, key) {
  const r2Key = String(key || '').trim();
  if (!r2Key) return null;
  const binding = getCmsR2Binding(env, CMS_DEFAULT_R2_BUCKET);
  const object = binding ? await binding.get(r2Key).catch(() => null) : null;
  if (!object) return null;
  return jsonObject(await object.text());
}
export async function hydrateCmsSectionRow(env, row, { published = false } = {}) {
  if (!row) return row;
  const key = published ? String(row.published_r2_key || '').trim() : String(row.draft_r2_key || row.published_r2_key || '').trim();
  const data = key ? await readCmsSectionArtifact(env, key) : null;
  return { ...row, section_data: data || jsonObject(row.section_data) };
}
export async function hydrateCmsSectionRows(env, rows, options) {
  return Promise.all((rows || []).map((row) => hydrateCmsSectionRow(env, row, options)));
}
export async function publishCmsPageSectionArtifacts(env, { page, pageId }) {
  const db = env?.DB;
  const binding = getCmsR2Binding(env, CMS_DEFAULT_R2_BUCKET);
  if (!db?.prepare || !binding) throw new Error('CMS publication storage unavailable');
  const { results = [] } = await db.prepare(`SELECT id,page_id,section_type,section_name,section_data,sort_order,is_visible,draft_r2_key,published_r2_key,r2_bucket,content_hash,published_hash,schema_version FROM cms_page_sections WHERE page_id=? ORDER BY sort_order ASC,section_name ASC`).bind(pageId).all();
  const publicationId = `${Date.now()}-${crypto.randomUUID()}`;
  const receipts = [];
  for (const row of results || []) {
    let data = row.draft_r2_key ? await readCmsSectionArtifact(env, row.draft_r2_key) : null;
    if (!data) data = jsonObject(row.section_data);
    const body = JSON.stringify(data);
    const hash = await sha256(body);
    const key = cmsSectionPublicationKey(publicationId, row.id);
    await binding.put(key, body, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
    receipts.push({ id: row.id, type: row.section_type, name: row.section_name, sort_order: Number(row.sort_order || 0), is_visible: row.is_visible === 1 || row.is_visible === true, schema_version: Number(row.schema_version || 1), r2_key: key, content_hash: hash });
  }
  const route = String(page?.route_path || `/${page?.slug || ''}`).trim() || '/';
  const manifest = { version: 1, publication_id: publicationId, published_at: Date.now(), page: { id: pageId, project_slug: page?.project_slug || page?.project_id || null, route_path: route, slug: page?.slug || null, title: page?.title || null, page_type: page?.page_type || null }, sections: receipts };
  const manifestKey = cmsPageManifestKey(publicationId);
  await binding.put(manifestKey, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  const statements = receipts.map((r) => db.prepare(`UPDATE cms_page_sections SET published_r2_key=?,published_hash=? WHERE id=?`).bind(r.r2_key, r.content_hash, r.id));
  statements.push(db.prepare(`UPDATE cms_pages SET published_manifest_r2_key=? WHERE id=?`).bind(manifestKey, pageId));
  if (typeof db.batch === 'function') await db.batch(statements); else for (const statement of statements) await statement.run();
  if (env?.SESSION_CACHE) await env.SESSION_CACHE.put(cmsPublishedRoutePointerKey(route), JSON.stringify({ version: 1, page_id: pageId, publication_id: publicationId, r2_bucket: CMS_DEFAULT_R2_BUCKET, manifest_r2_key: manifestKey }));
  return { publication_id: publicationId, manifest_r2_key: manifestKey, sections: receipts };
}
export async function loadCmsPublishedManifestByRoute(env, routePath) {
  const route = String(routePath || '').trim() || '/';
  let pointer = null;
  if (env?.SESSION_CACHE) {
    const raw = await env.SESSION_CACHE.get(cmsPublishedRoutePointerKey(route)).catch(() => null);
    if (raw) { try { pointer = JSON.parse(raw); } catch {} }
  }
  if (!pointer?.manifest_r2_key && env?.DB?.prepare) {
    const page = await env.DB.prepare(`SELECT id,published_manifest_r2_key FROM cms_pages WHERE route_path=? AND status='published' AND COALESCE(is_active,1)=1 LIMIT 1`).bind(route).first().catch(() => null);
    if (page?.published_manifest_r2_key) pointer = { page_id: page.id, manifest_r2_key: page.published_manifest_r2_key };
  }
  if (!pointer?.manifest_r2_key) return null;
  const binding = getCmsR2Binding(env, CMS_DEFAULT_R2_BUCKET);
  const object = binding ? await binding.get(pointer.manifest_r2_key).catch(() => null) : null;
  if (!object) return null;
  try {
    const parsed = JSON.parse(await object.text());
    return parsed && typeof parsed === 'object'
      ? { ...parsed, manifest_r2_key: pointer.manifest_r2_key }
      : null;
  } catch {
    return null;
  }
}
