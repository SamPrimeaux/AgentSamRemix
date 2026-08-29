/**
 * POST /api/cms/projects/create — register cms_site + optional homepage seed.
 */
import { cmsProjectContextRowId } from './cms-project-context.js';
import { invalidateCmsBootstrapCache } from './cms-kv-cache.js';
import { renderCmsSectionTreeHtml } from './cms-edit-safety.js';
import { persistBootstrapCmsProjectSlug, resolveCmsWorkspaceContext } from './cms-workspace-resolve.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from './cms-r2-binding.js';
import { emitInnerAnimalProEvent } from './inneranimalpro-stream.js';
import { resolveAccountCloudflareContext } from './account-cloudflare-context.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function toSlug(raw) {
  return trim(raw)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isValidProjectSlug(slug) {
  return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(slug) || /^[a-z0-9]$/.test(slug);
}

/** @param {string} sectionKey @param {number} sortOrder @param {string} projectName */
function scaffoldSection(sectionKey, sortOrder, projectName) {
  const name = projectName || 'Your site';
  const map = {
    hero: {
      section_type: 'hero',
      section_name: 'main-hero',
      section_data: {
        headline: name,
        subheadline: 'Welcome — edit this hero in the CMS studio.',
        cta_label: 'Get started',
        cta_href: '#',
      },
    },
    nav: {
      section_type: 'nav',
      section_name: 'site-nav',
      section_data: {
        logo_text: name,
        links: [{ label: 'Home', href: '/' }],
      },
    },
    cta: {
      section_type: 'cta',
      section_name: 'primary-cta',
      section_data: {
        headline: 'Ready to launch?',
        body: 'Replace this call-to-action with your own offer.',
        button_label: 'Contact us',
        button_href: '#contact',
      },
    },
    features: {
      section_type: 'features',
      section_name: 'features',
      section_data: {
        headline: 'What we offer',
        items: ['Feature one', 'Feature two', 'Feature three'],
      },
    },
    pricing: {
      section_type: 'pricing',
      section_name: 'pricing',
      section_data: { headline: 'Plans & pricing' },
    },
    testimonials: {
      section_type: 'testimonials',
      section_name: 'testimonials',
      section_data: { headline: 'What clients say' },
    },
    footer: {
      section_type: 'footer',
      section_name: 'site-footer',
      section_data: { copyright: `© ${new Date().getFullYear()} ${name}` },
    },
    gallery: {
      section_type: 'gallery',
      section_name: 'gallery',
      section_data: { headline: 'Gallery' },
    },
    faq: {
      section_type: 'faq',
      section_name: 'faq',
      section_data: { headline: 'FAQ' },
    },
  };
  const base = map[sectionKey];
  if (!base) return null;
  return { ...base, sort_order: sortOrder };
}

function cmsPageKey(workspaceId, projectSlug, pageSlug, variant) {
  return `cms/${workspaceId}/${projectSlug}/${pageSlug}/${variant}.html`;
}

function resolvePublicDomain(payload, slug) {
  const mode = trim(payload.domain_mode || 'subdomain');
  if (mode === 'custom') return trim(payload.custom_domain || payload.public_domain) || null;
  if (mode === 'subdomain') {
    const sub = trim(payload.subdomain) || slug;
    return sub ? `${sub}.inneranimalmedia.com` : null;
  }
  return trim(payload.public_domain) || null;
}

function normalizeHostingLane(payload) {
  const lane = trim(payload.hosting_lane || payload.hosting || 'platform_shared');
  if (lane === 'isolated_build' || lane === 'localhost_dev') return lane;
  return 'platform_shared';
}

/**
 * Enforce Companions-style hosting lanes — platform shared must not spin dedicated CF on IAM's dime.
 * @param {any} env
 * @param {{ tenantId: string, workspaceId: string, userId: string, authUser?: import('../core/auth.js').AuthUser|null, payload: Record<string, unknown> }} scope
 * @param {string} projectSlug
 */
async function enforceHostingLane(env, scope, payload, projectSlug) {
  const lane = normalizeHostingLane(payload);
  const localDevPort = trim(payload.local_dev_port) || '8787';

  if (lane === 'platform_shared') {
    payload.worker = 'existing';
    payload.worker_name = '';
    payload.bucket = 'cms';
    payload.kv_draft_cache = false;
    return { ok: true, lane, localDevPort, registryOnly: false };
  }

  if (lane === 'localhost_dev') {
    payload.worker = 'existing';
    payload.worker_name = '';
    payload.bucket = 'cms';
    payload.kv_draft_cache = false;
    payload.repo_mode = 'skip';
    payload.domain_mode = 'later';
    payload.skip_seed = true;
    return { ok: true, lane, localDevPort, registryOnly: true };
  }

  const cfCtx = await resolveAccountCloudflareContext(env, {
    userId: scope.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    authUser: scope.authUser || null,
  });
  if (!cfCtx.ok || !cfCtx.token) {
    return {
      ok: false,
      status: 403,
      error: 'cloudflare_oauth_required',
      message:
        'Connect Cloudflare OAuth or add a BYOK API token before provisioning an isolated build.',
    };
  }
  if (!cfCtx.account_id) {
    return {
      ok: false,
      status: 403,
      error: 'cloudflare_account_id_missing',
      message: 'Cloudflare account id required — connect OAuth once; account id is stored account-wide.',
    };
  }

  payload.worker = 'new';
  payload.worker_name = trim(payload.worker_name) || `${projectSlug}-worker`;
  payload.bucket = 'new';
  payload.kv_draft_cache = true;
  payload.cf_account_id = cfCtx.account_id;
  payload.cf_credential_source = cfCtx.source;
  if (trim(payload.repo_mode) === 'skip') {
    payload.repo_mode = 'new';
    payload.repo_name = trim(payload.repo_name) || projectSlug;
  }

  return {
    ok: true,
    lane,
    localDevPort,
    registryOnly: false,
    isolated: true,
    cf_account_id: cfCtx.account_id,
    cf_credential_source: cfCtx.source,
  };
}

function buildDeferredSteps(payload) {
  const steps = [];
  if (trim(payload.worker) === 'new') {
    steps.push({
      step: 'deploy_worker',
      detail: trim(payload.worker_name) || 'Dedicated Worker not auto-deployed yet',
    });
  }
  if (trim(payload.bucket) === 'new') {
    steps.push({ step: 'create_r2_bucket', detail: `${toSlug(payload.project_slug)}-assets` });
  }
  if (trim(payload.repo_mode) !== 'skip') {
    steps.push({
      step: 'link_github_repo',
      detail: `${trim(payload.repo_org)}/${trim(payload.repo_name) || 'repo'} (${trim(payload.repo_branch) || 'main'})`,
    });
  }
  if (trim(payload.domain_mode) === 'subdomain') {
    steps.push({ step: 'dns_subdomain', detail: resolvePublicDomain(payload, toSlug(payload.project_slug)) });
  }
  if (trim(payload.domain_mode) === 'custom') {
    steps.push({ step: 'dns_custom_domain', detail: trim(payload.custom_domain) });
  }
  if (trim(payload.cms_template) === 'shopify' && trim(payload.import_mode) !== 'theme_zip') {
    steps.push({ step: 'shopify_import', detail: 'Upload theme zip via CMS Imports' });
  }
  if (payload.pipeline_binding === false) {
    steps.push({ step: 'pipeline_binding_skipped', detail: 'Enable iam-cms-pipeline in wrangler to use AI sections' });
  }
  return steps;
}

/**
 * @param {any} env
 * @param {ExecutionContext} ctx
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   userId: string,
 *   personUuid?: string|null,
 *   authUser: import('../core/auth.js').AuthUser,
 *   request: Request,
 *   payload: Record<string, unknown>,
 * }} opts
 */
export async function provisionCmsProject(env, ctx, opts) {
  const tenantId = trim(opts.tenantId);
  const workspaceId = trim(opts.workspaceId);
  const userId = trim(opts.userId);
  const personUuid = trim(opts.personUuid) || userId;
  const payload = opts.payload || {};

  const projectName = trim(payload.project_name) || 'New site';
  const projectSlug = toSlug(payload.project_slug || payload.project_name);
  if (!projectSlug || !isValidProjectSlug(projectSlug)) {
    return { ok: false, status: 400, error: 'invalid_project_slug', slug: projectSlug || null };
  }

  if (!env?.DB) return { ok: false, status: 503, error: 'Database unavailable' };

  const hosting = await enforceHostingLane(
    env,
    { tenantId, workspaceId, userId, authUser: opts.authUser || null, payload },
    payload,
    projectSlug,
  );
  if (!hosting.ok) {
    return {
      ok: false,
      status: hosting.status || 403,
      error: hosting.error,
      message: hosting.message || hosting.error,
    };
  }

  const existingCtx = await env.DB.prepare(
    `SELECT id FROM agentsam_project_context
     WHERE workspace_id = ? AND project_key = ? LIMIT 1`,
  )
    .bind(workspaceId, projectSlug)
    .first()
    .catch(() => null);

  const existingPages = await env.DB.prepare(
    `SELECT id FROM cms_pages
     WHERE workspace_id = ? AND project_slug = ? AND status != 'archived' LIMIT 1`,
  )
    .bind(workspaceId, projectSlug)
    .first()
    .catch(() => null);

  if (existingCtx?.id || existingPages?.id) {
    return { ok: false, status: 409, error: 'project_slug_taken', project_slug: projectSlug };
  }

  const publicDomain = resolvePublicDomain(payload, projectSlug);
  const r2Bucket =
    trim(payload.bucket) === 'new' ? `${projectSlug}-assets` : CMS_DEFAULT_R2_BUCKET;
  const workerName =
    trim(payload.worker) === 'new'
      ? trim(payload.worker_name) || `${projectSlug}-worker`
      : 'inneranimalmedia';

  const provisioningMeta = {
    hosting_lane: hosting.lane,
    local_dev_port: hosting.localDevPort,
    isolation_pattern: hosting.isolated ? 'companions' : null,
    cf_account_id: hosting.cf_account_id || trim(payload.cf_account_id) || null,
    cf_credential_source: hosting.cf_credential_source || trim(payload.cf_credential_source) || null,
    registry_only: hosting.registryOnly === true,
    project_type: trim(payload.project_type) || 'new',
    worker: trim(payload.worker) || 'existing',
    worker_name: workerName,
    bucket: trim(payload.bucket) || 'cms',
    r2_bucket: r2Bucket,
    kv_draft_cache: !!payload.kv_draft_cache,
    repo_mode: trim(payload.repo_mode) || 'skip',
    repo_org: trim(payload.repo_org) || null,
    repo_name: trim(payload.repo_name) || null,
    repo_branch: trim(payload.repo_branch) || 'main',
    cf_builds: payload.cf_builds !== false,
    domain_mode: trim(payload.domain_mode) || 'subdomain',
    public_domain: publicDomain,
    cms_template: trim(payload.cms_template) || 'starter',
    sections: Array.isArray(payload.sections) ? payload.sections : [],
    agentic_tools: payload.agentic_tools !== false,
    pipeline_binding: payload.pipeline_binding !== false,
    import_mode: trim(payload.import_mode) || null,
    skip_seed: payload.skip_seed === true || trim(payload.cms_template) === 'shopify',
    provisioned_at: new Date().toISOString(),
  };
  const description = [
    `CMS site \`${projectSlug}\` (${projectName}) on workspace ${workspaceId}.`,
    publicDomain ? `Public domain: ${publicDomain}.` : 'Domain pending.',
    `Template: ${provisioningMeta.cms_template}.`,
  ].join(' ');

  const ctxId = cmsProjectContextRowId(projectSlug);

  await env.DB.prepare(
    `INSERT INTO agentsam_project_context (
       id, tenant_id, workspace_id, project_key, project_name, project_type,
       status, priority, description, primary_tables, related_routes,
       workers_involved, r2_buckets_involved, notes, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, 'cms_site', 'active', 80, ?, ?, ?,
       ?, ?, ?, unixepoch(), unixepoch()
     )`,
  )
    .bind(
      ctxId,
      tenantId,
      workspaceId,
      projectSlug,
      projectName,
      description,
      '["cms_pages","cms_page_sections","cms_themes","cms_page_drafts"]',
      '["cms_edit","/dashboard/cms/*","/api/cms/bootstrap","/api/cms/projects/create"]',
      workerName,
      r2Bucket,
      JSON.stringify(provisioningMeta),
    )
    .run();

  if (publicDomain) {
    await env.DB.prepare(
      `INSERT INTO cms_tenants (id, tenant_ref_id, slug, name, domain, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         domain = excluded.domain,
         is_active = 1,
         updated_at = unixepoch()`,
    )
      .bind(`cms_tenant_${projectSlug}`, tenantId, projectSlug, projectName, publicDomain)
      .run()
      .catch(() => {});
  }

  let pageId = null;
  let homepageSlug = null;
  const cmsTemplate = provisioningMeta.cms_template;
  const skipHomepageSeed =
    provisioningMeta.skip_seed === true ||
    hosting.registryOnly === true ||
    hosting.lane === 'localhost_dev';

  if (!skipHomepageSeed && cmsTemplate !== 'shopify') {
    const sectionKeys =
      cmsTemplate === 'blank'
        ? []
        : (provisioningMeta.sections.length
            ? provisioningMeta.sections
            : ['hero', 'nav', 'cta']);

    homepageSlug = 'home';
    pageId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const routePath = '/';
    const sections = [];
    for (let i = 0; i < sectionKeys.length; i++) {
      const key = trim(sectionKeys[i]);
      const row = scaffoldSection(key, (i + 1) * 10, projectName);
      if (!row) continue;
      const sectionId = `sec_${projectSlug}_${key}_${i}`;
      sections.push({ id: sectionId, ...row, is_visible: 1 });
    }

    const html =
      sections.length > 0
        ? renderCmsSectionTreeHtml(sections, {})
        : `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${projectName}</title></head><body><main data-cms-section="blank"><h1>${projectName}</h1></main></body></html>`;

    const r2Binding = getCmsR2Binding(env, CMS_DEFAULT_R2_BUCKET);
    if (!r2Binding) {
      return { ok: false, status: 503, error: 'R2 storage unavailable' };
    }

    const draftKey = cmsPageKey(workspaceId, projectSlug, homepageSlug, 'draft');
    const publishedKey = cmsPageKey(workspaceId, projectSlug, homepageSlug, 'published');
    const contentBuffer = new TextEncoder().encode(html);

    await r2Binding.put(draftKey, contentBuffer, {
      httpMetadata: { contentType: 'text/html' },
    });
    await r2Binding.put(publishedKey, contentBuffer, {
      httpMetadata: { contentType: 'text/html' },
    });

    await env.DB.prepare(
      `INSERT INTO cms_pages (
         id, project_id, project_slug, slug, title, status, route_path, path, page_type,
         tenant_id, workspace_id, person_uuid, created_by, updated_by,
         r2_key, r2_bucket, content_type, content_size_bytes,
         seo_title, meta_description, is_homepage,
         created_at, updated_at, published_at
       ) VALUES (?, ?, ?, ?, ?, 'published', ?, ?, 'home', ?, ?, ?, ?, ?, ?, ?, 'text/html', ?, ?, ?, 1, ?, ?, ?)`,
    )
      .bind(
        pageId,
        projectSlug,
        projectSlug,
        homepageSlug,
        projectName,
        routePath,
        routePath,
        tenantId,
        workspaceId,
        personUuid,
        userId,
        userId,
        publishedKey,
        CMS_DEFAULT_R2_BUCKET,
        contentBuffer.byteLength,
        projectName,
        `${projectName} — ${projectSlug}`,
        now,
        now,
        now,
      )
      .run();

    for (const sec of sections) {
      await env.DB.prepare(
        `INSERT INTO cms_page_sections
         (id, page_id, section_type, section_name, section_data, sort_order, is_visible, css_classes, custom_css, created_at_unix)
         VALUES (?, ?, ?, ?, ?, ?, 1, '', '', ?)`,
      )
        .bind(
          sec.id,
          pageId,
          sec.section_type,
          sec.section_name,
          JSON.stringify(sec.section_data || {}),
          sec.sort_order,
          now,
        )
        .run();
    }
  }

  const requestCache = {};
  const wsCtx = await resolveCmsWorkspaceContext(env, opts.request, opts.authUser, requestCache).catch(
    () => null,
  );
  if (wsCtx?.bootstrap_id) {
    await persistBootstrapCmsProjectSlug(env, {
      bootstrapId: wsCtx.bootstrap_id,
      userId,
      workspaceId,
      projectSlug,
    });
  }

  ctx.waitUntil(invalidateCmsBootstrapCache(env, workspaceId, projectSlug));
  emitInnerAnimalProEvent(
    env,
    {
      userId,
      eventName: `cms_project_created:${projectSlug}:${cmsTemplate}`,
    },
    ctx,
  );

  return {
    ok: true,
    project_slug: projectSlug,
    project_name: projectName,
    page_id: pageId,
    homepage_slug: homepageSlug,
    public_domain: publicDomain,
    studio_path: `/dashboard/cms/pages?site=${encodeURIComponent(projectSlug)}`,
    deferred_steps: buildDeferredSteps({ ...payload, project_slug: projectSlug }),
  };
}
