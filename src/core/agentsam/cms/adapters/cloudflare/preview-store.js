import { cmsPreviewRouteCandidates } from '../../preview/selection.js';
import { hydrateCmsSectionRows } from './section-artifacts.js';
function parseDraft(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

export function createCloudflareCmsPreviewStore(env) {
  if (!env?.DB?.prepare) throw new TypeError('D1 database binding required');
  const db = env.DB;
  return {
    async getPageById(id) {
      return db.prepare(`SELECT * FROM cms_pages WHERE id = ? LIMIT 1`).bind(String(id)).first().catch(() => null);
    },
    async findPageByRoute(routePath, { includeDraft = false, explicitPageId = null } = {}) {
      const statusSql = includeDraft ? `status != 'archived'` : `status = 'published' AND COALESCE(is_active, 1) = 1`;
      if (explicitPageId) {
        const explicit = await db.prepare(`SELECT * FROM cms_pages WHERE id = ? AND ${statusSql} LIMIT 1`).bind(String(explicitPageId)).first().catch(() => null);
        if (explicit?.id) return explicit;
      }
      for (const candidate of cmsPreviewRouteCandidates(routePath)) {
        const page = await db.prepare(`SELECT * FROM cms_pages WHERE route_path = ? AND ${statusSql} ORDER BY CASE WHEN route_path = '/' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`).bind(candidate).first().catch(() => null);
        if (page?.id) return page;
      }
      const slug = String(routePath || '').trim().replace(/^\/+|\/+$/g, '');
      if (!slug) return null;
      return db.prepare(`SELECT * FROM cms_pages WHERE slug = ? AND ${statusSql} ORDER BY updated_at DESC LIMIT 1`).bind(slug).first().catch(() => null);
    },
    async listSections(pageId) {
      const { results } = await db.prepare(`SELECT * FROM cms_page_sections WHERE page_id = ? ORDER BY sort_order ASC, section_name ASC`).bind(String(pageId)).all().catch(() => ({ results: [] }));
      return hydrateCmsSectionRows(env, results || []);
    },
    async listBlocks(sectionId) {
      const { results } = await db.prepare(`SELECT * FROM cms_section_components WHERE section_id = ? ORDER BY sort_order ASC, id ASC`).bind(String(sectionId)).all().catch(() => ({ results: [] }));
      return results || [];
    },
    async listBlocksForSections(sectionIds) {
      const ids = [...new Set((sectionIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
      if (!ids.length) return {};
      const placeholders = ids.map(() => '?').join(',');
      const { results } = await db.prepare(`SELECT * FROM cms_section_components WHERE section_id IN (${placeholders}) ORDER BY section_id ASC, sort_order ASC, id ASC`).bind(...ids).all().catch(() => ({ results: [] }));
      const grouped = {};
      for (const row of results || []) {
        const sectionId = String(row.section_id || '');
        if (!grouped[sectionId]) grouped[sectionId] = [];
        grouped[sectionId].push(row);
      }
      return grouped;
    },

    async getDraftRecord(pageId, userId) {
      const kv = env?.SESSION_CACHE;
      const kvRaw = kv ? await kv.get(`cms:draft:${String(pageId)}:${String(userId)}`).catch(() => null) : null;
      const kvDraft = parseDraft(kvRaw);
      if (kvDraft) {
        return {
          draftData: kvDraft?.draft_data || kvDraft,
          source: 'kv',
          updatedAt: kvDraft?.cached_at || null,
        };
      }
      const row = await db.prepare(`SELECT draft_data, updated_at FROM cms_page_drafts WHERE page_id = ? AND user_id = ? LIMIT 1`).bind(String(pageId), String(userId)).first().catch(() => null);
      return row ? { draftData: parseDraft(row.draft_data), source: 'd1', updatedAt: row.updated_at || null } : { draftData: null, source: null, updatedAt: null };
    },
    async getDraft(pageId, userId) {
      return (await this.getDraftRecord(pageId, userId)).draftData;
    },
  };
}
