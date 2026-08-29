/**
 * CMS M2 edit safety — drafts, overrides, activity, patch sessions, preview HTML.
 */
import { logSkillInvocation } from '../api/agentsam.js';
import { recordAgentsamPatchSession } from './agentsam-patch-sessions.js';
import { invalidateCmsBootstrapCache } from './cms-kv-cache.js';
import {
  buildCmsPreviewModel,
  cmsPreviewModelToLegacy,
  loadCmsPreviewByPageId,
  mergeCmsDraftSections as mergeCanonicalCmsDraftSections,
  renderCmsPreviewFallbackHtml,
} from './agentsam/cms/preview/index.js';
import { createCloudflareCmsPreviewStore } from './agentsam/cms/adapters/cloudflare/preview-store.js';
import {
  clearCmsDraft,
  persistCmsDraft,
  stageCmsDraft,
} from './agentsam/cms/lifecycle/index.js';
import { createCloudflareCmsLifecycleStore } from './agentsam/cms/adapters/cloudflare/lifecycle-store.js';

const CMS_EDIT_SKILL_ID = 'skill_iam_cms_edit';

/** @param {string} workspaceId @param {string} projectId @param {string} slug @param {string} variant */
export function cmsPageHtmlKey(workspaceId, projectId, slug, variant) {
  return `cms/${workspaceId}/${projectId}/${slug}/${variant}.html`;
}

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   userId: string,
 *   action: string,
 *   resourceType: string,
 *   resourceId: string,
 *   details?: string|null,
 * }} opts
 */
export async function logCmsActivity(env, opts) {
  if (!env?.DB) return;
  const tenantId = String(opts?.tenantId || '').trim();
  const userId = String(opts?.userId || '').trim();
  if (!tenantId || !userId) return;
  const details =
    opts.details != null
      ? typeof opts.details === 'string'
        ? opts.details
        : JSON.stringify(opts.details)
      : null;
  await env.DB.prepare(
    `INSERT INTO cms_activity_log (id, tenant_id, user_id, action, resource_type, resource_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      tenantId,
      userId,
      String(opts.action || 'update').slice(0, 40),
      String(opts.resourceType || 'cms').slice(0, 40),
      String(opts.resourceId || '').slice(0, 120),
      details,
      Math.floor(Date.now() / 1000),
    )
    .run()
    .catch(() => {});
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 *   userId?: string|null,
 *   projectSlug: string,
 *   pageId: string,
 *   sectionId?: string|null,
 *   changeSetId?: string|null,
 *   agentApplied?: boolean,
 *   routeKey?: string|null,
 * }} opts
 */
export function auditCmsMutation(env, ctx, opts) {
  const slug = String(opts.projectSlug || '').trim();
  const pageId = String(opts.pageId || '').trim();
  const sectionId = String(opts.sectionId || 'page').trim();
  if (!slug || !pageId) return;

  const taskFile = `cms/${slug}/${pageId}/${sectionId}`.slice(0, 200);
  const planId = opts.changeSetId || `cms_${pageId}_${Date.now().toString(36)}`;

  recordAgentsamPatchSession(env, ctx, {
    planId,
    changeSetId: opts.changeSetId || null,
    taskFile,
    workspaceId: opts.workspaceId,
    tenantId: opts.tenantId,
    applied: 1,
    passed: 1,
    provider: 'cms_api',
  });

  const routeKey = String(opts.routeKey || '').trim();
  const agentApplied = opts.agentApplied === true || routeKey === 'cms_edit';
  if (agentApplied && opts.userId) {
    const run = async () => {
      try {
        await logSkillInvocation(env, {
          skillId: CMS_EDIT_SKILL_ID,
          conversationId: opts.changeSetId || null,
          triggerMethod: agentApplied ? 'agent_apply' : 'cms_edit_route',
          inputSummary: taskFile.slice(0, 200),
          success: true,
          durationMs: 0,
          modelUsed: 'cms_edit',
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        });
      } catch (_) {}
    };
    if (ctx?.waitUntil) ctx.waitUntil(run());
    else void run();
  }
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {string} workspaceId
 * @param {string} projectSlug
 */
export function invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug) {
  const ws = String(workspaceId || '').trim();
  const slug = String(projectSlug || '').trim();
  if (!ws || !slug) return;
  const p = invalidateCmsBootstrapCache(env, ws, slug);
  if (ctx?.waitUntil) ctx.waitUntil(p);
  else void p;
}

/**
 * @param {any} env
 * @param {{
 *   pageId: string,
 *   userId: string,
 *   draftData: Record<string, unknown>,
 * }} opts
 */
export async function flushCmsDraftToD1(env, opts) {
  if (!env?.DB) return { ok: false };
  const store = createCloudflareCmsLifecycleStore(env);
  return persistCmsDraft(store, {
    pageId: opts?.pageId,
    userId: opts?.userId,
    draftData: opts?.draftData || null,
  });
}

/**
 * @param {Array<Record<string, unknown>>} sections
 * @param {Record<string, Array<Record<string, unknown>>>} componentsBySection
 */
export function renderCmsSectionTreeHtml(sections, componentsBySection = {}, opts = {}) {
  const page = { id: '__preview__', route_path: '/', slug: 'home', status: 'draft', page_type: 'home' };
  const model = buildCmsPreviewModel({
    page,
    sections,
    blocksBySection: componentsBySection,
    previewMode: 'draft',
    userId: '__renderer__',
  });
  return renderCmsPreviewFallbackHtml(model, opts);
}

/**
 * @param {any} env
 * @param {string} pageId
 * @param {string} userId
 */
export async function clearCmsDraftHotCache(env, pageId, userId) {
  if (!env?.DB) return;
  const store = createCloudflareCmsLifecycleStore(env);
  await clearCmsDraft(store, { pageId, userId, clearDurable: false });
}

/**
 * @param {any} env
 * @param {{ pageId: string, userId: string, payload: Record<string, unknown> }} opts
 */
export async function stageCmsDraftKv(env, opts) {
  if (!env?.DB) return { ok: false };
  const store = createCloudflareCmsLifecycleStore(env);
  return stageCmsDraft(store, {
    pageId: opts.pageId,
    userId: opts.userId,
    draftData: opts.payload,
  });
}

/**
 * Merge KV/D1 draft section overrides onto page sections for preview/publish HTML.
 * @param {Array<Record<string, unknown>>} sections
 * @param {Record<string, unknown>|null} draftData
 */
export function mergeCmsDraftSections(sections, draftData) {
  return mergeCanonicalCmsDraftSections(sections, draftData);
}

/**
 * @param {any} env
 * @param {string} pageId
 * @param {string} userId
 * @param {Record<string, unknown>|null} [draftDataOverride]
 */
export async function loadCmsPagePreviewContext(env, pageId, userId, draftDataOverride = null) {
  if (!env?.DB) return null;
  const store = createCloudflareCmsPreviewStore(env);
  const model = await loadCmsPreviewByPageId(pageId, {
    previewMode: 'draft',
    userId,
    draftData: draftDataOverride,
  }, store);
  return model ? cmsPreviewModelToLegacy(model) : null;
}

/**
 * Render section tree HTML and persist to R2 draft.html (publish prerequisite).
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   page: Record<string, unknown>,
 *   userId: string,
 *   draftData?: Record<string, unknown>|null,
 * }} opts
 */
