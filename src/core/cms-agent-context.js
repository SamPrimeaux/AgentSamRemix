/**
 * CMS context injection for Agent Sam chat spine.
 */
import { normalizeWorkspaceContextPacket } from './workspace-studio-context.js';
import {
  buildAgentSiteContext,
  formatAgentSiteContextForPrompt,
} from './cms-site-spine.js';

const CMS_PROTOCOL_LINES = [
  'Loop: read site spine → D1/R2 (or thin cms helpers) against those keys → publish assemble → verify live_url',
  'Always verify live_url after publish — reject Clean canvas / synthetic CMS Preview / 404 as incomplete.',
].join('\n');

/**
 * @param {unknown} body
 * @param {unknown} browserContext
 */
export function extractCmsAgentContext(body, browserContext) {
  const b = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {};
  const bc =
    browserContext && typeof browserContext === 'object'
      ? /** @type {Record<string, unknown>} */ (browserContext)
      : {};

  const fromBody = b.cms_context ?? b.cmsContext;
  const ws = normalizeWorkspaceContextPacket(browserContext, body);

  const projectSlug =
    (fromBody && typeof fromBody === 'object' ? fromBody.project_slug : null) ??
    ws?.project_slug ??
    bc.project_slug ??
    null;

  const fromPacket =
    (fromBody && typeof fromBody === 'object' && fromBody.agent_site_context) ||
    ws?.agent_site_context ||
    bc.agent_site_context ||
    null;

  const spine =
    (fromPacket && typeof fromPacket === 'object' ? fromPacket : null) ||
    buildAgentSiteContext(projectSlug, {
      api_profile: ws?.api_profile ?? bc.api_profile,
      cms_hosting: ws?.cms_hosting ?? bc.cms_hosting,
      r2_bucket: ws?.r2_bucket ?? bc.r2_bucket,
      public_domain: ws?.public_domain ?? bc.public_domain,
      d1_database_id: ws?.d1_database_id ?? bc.d1_database_id,
    }, {
      page_id: ws?.page_id ?? bc.page_id,
      r2_key: ws?.r2_key ?? bc.r2_key,
      route_path: ws?.route_path ?? bc.route_path,
    });


  const merged = {
    project_slug: projectSlug,
    page_id:
      (fromBody && typeof fromBody === 'object' ? fromBody.page_id : null) ??
      ws?.page_id ??
      bc.page_id ??
      null,
    studio_panel: ws?.studio_panel ?? bc.studio_panel ?? null,
    section_id:
      fromBody && typeof fromBody === 'object' ? fromBody.section_id ?? null : null,
    section_type:
      fromBody && typeof fromBody === 'object' ? fromBody.section_type ?? null : null,
    live_session_id: ws?.live_session_id ?? bc.live_session_id ?? null,
    collab_room: ws?.collab_room ?? bc.collab_room ?? null,
    bootstrap_cache_key: ws?.bootstrap_cache_key ?? bc.bootstrap_cache_key ?? null,
    preview_url: ws?.preview_url ?? bc.preview_url ?? null,
    public_domain: ws?.public_domain ?? bc.public_domain ?? spine?.public_domain ?? null,
    cms_hosting: ws?.cms_hosting ?? bc.cms_hosting ?? spine?.cms_hosting ?? spine?.cms_mode ?? null,
    api_profile: ws?.api_profile ?? bc.api_profile ?? spine?.api_profile ?? null,
    picked_element: ws?.picked_element ?? bc.picked_element ?? bc.selected_element ?? null,
    r2_bucket: ws?.r2_bucket ?? bc.r2_bucket ?? spine?.r2_bucket ?? null,
    r2_key: ws?.r2_key ?? bc.r2_key ?? null,
    agent_site_context: spine,
    do_binding: ws?.do_binding ?? bc.do_binding ?? spine?.do_binding ?? null,
    kv_binding: ws?.kv_binding ?? bc.kv_binding ?? spine?.kv_binding ?? null,
  };

  const hasSignal =
    merged.project_slug ||
    merged.page_id ||
    merged.section_id ||
    merged.live_session_id ||
    merged.bootstrap_cache_key;
  return hasSignal ? merged : null;
}

/**
 * On-demand CMS payload formatter — do NOT append ambiently every chat turn.
 * Call only when the user is on a CMS surface and this chat is about that page,
 * or when they @-attach CMS context.
 * @param {Record<string, unknown>|null} cms
 */
export function formatCmsContextForAgent(cms) {
  if (!cms || typeof cms !== 'object') return '';
  const profile = String(cms.api_profile || '').trim();
  const siteLock = [
    'SITE LOCK: Only edit this project_slug. Refuse other sites.',
    'Do not invent page_id / section_id / section_name — use values below or read first.',
    profile === 'cpas_fragment'
      ? 'api_profile=cpas_fragment: use bridge section save/publish — not PrimeTech full-page remaster.'
      : profile === 'fuel_admin'
        ? 'api_profile=fuel_admin: Fuel admin CMS tools only.'
        : 'api_profile=primetch (or default): PrimeTech read → save → publish → verify.',
    'Instruction SSOT is D1 skills/rules/routes — do not invent system prompts from R2 markdown.',
  ].join(' ');
  const spineBlock = formatAgentSiteContextForPrompt(
    cms.agent_site_context && typeof cms.agent_site_context === 'object'
      ? cms.agent_site_context
      : buildAgentSiteContext(cms.project_slug, cms, {
          page_id: cms.page_id,
          r2_key: cms.r2_key,
        }),
  );
  const lines = [
    '[CMS editor context — follow site lock. Do not invent page ids.]',
    siteLock,
    profile === 'cpas_fragment' || profile === 'fuel_admin' ? '' : CMS_PROTOCOL_LINES,
    `project_slug: ${cms.project_slug || '(none)'}`,
    `api_profile: ${profile || '(none)'}`,
    `page_id: ${cms.page_id || '(none)'}`,
    `studio_panel: ${cms.studio_panel || '(none)'}`,
    `section_id: ${cms.section_id || '(none)'}`,
    `section_type: ${cms.section_type || '(none)'}`,
    `live_session_id: ${cms.live_session_id || '(none)'}`,
    `collab_room (IAM_COLLAB): ${cms.collab_room || '(none)'}`,
    `bootstrap_cache_key: ${cms.bootstrap_cache_key || '(none)'}`,
    `preview_url: ${cms.preview_url || '(none)'}`,
    `public_domain: ${cms.public_domain || '(none)'}`,
    `cms_hosting: ${cms.cms_hosting || '(none)'}`,
    `r2_bucket: ${cms.r2_bucket || '(none)'}`,
    `r2_key: ${cms.r2_key || '(none)'}`,
  ].filter(Boolean);
  return `## CMS context\n${lines.join('\n')}${spineBlock ? `\n\n${spineBlock}` : ''}`;
}
