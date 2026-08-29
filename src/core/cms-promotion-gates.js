/**
 * CMS M3 publish gates — verify_contract + promotion_gate (cms_live_editor.* parity).
 * Invoked before POST /api/cms/pages/:id/publish.
 */

/** @param {unknown} v */
function isBlank(v) {
  return v == null || String(v).trim() === '';
}

/**
 * @param {any} env
 * @param {{
 *   page: Record<string, unknown>,
 *   workspaceId: string,
 *   tenantId: string,
 *   r2Binding: unknown,
 *   draftKey: string,
 *   hasKvDraft?: boolean,
 * }} opts
 */
export async function verifyCmsPublishContract(env, opts) {
  const page = opts.page || {};
  const pageId = String(page.id || '').trim();
  const slug = String(page.slug || '').trim();
  const routePath = String(page.route_path || '').trim();
  const title = String(page.title || '').trim();
  const checks = [];

  checks.push({ gate: 'page_id', passed: !!pageId, detail: pageId || 'missing' });
  checks.push({ gate: 'slug', passed: !!slug, detail: slug || 'missing' });
  checks.push({ gate: 'route_path', passed: !!routePath, detail: routePath || 'missing' });
  checks.push({ gate: 'title', passed: !!title, detail: title || 'missing' });

  let hasR2Draft = Boolean(opts.hasKvDraft);
  if (!hasR2Draft && opts.r2Binding && opts.draftKey) {
    const head = await opts.r2Binding.head(String(opts.draftKey)).catch(() => null);
    hasR2Draft = !!head;
  }
  checks.push({ gate: 'r2_draft', passed: hasR2Draft, detail: hasR2Draft ? opts.draftKey : 'missing' });

  const passed = checks.every((c) => c.passed);
  return {
    passed,
    pass: passed ? 1 : 0,
    route_key: 'cms_live_editor.verify_contract',
    checks,
    page_id: pageId,
  };
}

/**
 * @param {any} env
 * @param {{
 *   page: Record<string, unknown>,
 *   tenantId: string,
 *   projectSlug: string,
 *   r2Binding: unknown,
 *   draftKey: string,
 *   hasKvDraft?: boolean,
 * }} opts
 */
export async function runCmsPromotionGate(env, opts) {
  const page = opts.page || {};
  const pageId = String(page.id || '').trim();
  const projectSlug = String(opts.projectSlug || page.project_slug || page.project_id || '').trim();
  const routePath = String(page.route_path || '').trim();
  const blocks = [];

  let hasR2Draft = Boolean(opts.hasKvDraft);
  if (!hasR2Draft && opts.r2Binding && opts.draftKey) {
    const head = await opts.r2Binding.head(String(opts.draftKey)).catch(() => null);
    hasR2Draft = !!head;
  }
  if (!hasR2Draft) {
    blocks.push({ code: 'r2_missing', message: 'No draft content in R2 or KV to publish' });
  }

  if (env?.DB && projectSlug && routePath) {
    const dup = await env.DB.prepare(
      `SELECT id, slug FROM cms_pages
       WHERE project_slug = ? AND route_path = ? AND id != ? AND status != 'archived'
       LIMIT 1`,
    )
      .bind(projectSlug, routePath, pageId)
      .first()
      .catch(() => null);
    if (dup?.id) {
      blocks.push({
        code: 'duplicate_route_path',
        message: `route_path ${routePath} already used by page ${dup.slug || dup.id}`,
        conflicting_page_id: dup.id,
      });
    }
  }

  const seoTitle = String(page.seo_title || page.title || '').trim();
  const metaDescription = String(page.meta_description || '').trim();
  if (isBlank(seoTitle)) {
    blocks.push({ code: 'seo_title_empty', message: 'seo_title (or title) is required before publish' });
  }
  if (isBlank(metaDescription)) {
    blocks.push({ code: 'meta_description_empty', message: 'meta_description is required before publish' });
  }

  const passed = blocks.length === 0;
  return {
    passed,
    pass: passed ? 1 : 0,
    route_key: 'cms_live_editor.promotion_gate',
    blocks,
    page_id: pageId,
  };
}

/**
 * @param {{ contract: Record<string, unknown>, promotion: Record<string, unknown> }} gates
 */
export function cmsPublishGateErrorResponse(gates) {
  return {
    error: 'publish_gate_blocked',
    contract: gates.contract,
    promotion: gates.promotion,
    blocked: [
      ...(gates.contract?.checks || []).filter((c) => !c.passed).map((c) => c.gate),
      ...(gates.promotion?.blocks || []).map((b) => b.code),
    ],
  };
}
