/** CMS pipeline agent tools — thin adapters over iam-cms-pipeline binding. */
import { fetchCmsPipeline, fetchCmsPipelineJson, hasCmsPipelineBinding } from '../adapters/cloudflare/pipeline-service.js';
import {
  auditSitePackageById,
  convertLiquidSectionsToHtml,
  runThemePackagePythonAudit,
} from '../adapters/cloudflare/package-audit.js';

function missingBinding() {
  return { error: 'CMS_PIPELINE binding not configured — deploy iam-cms-pipeline and inneranimalmedia service binding' };
}

/**
 * @param {Record<string, unknown>} params
 * @param {any} env
 */
async function cmsPipelinePrototype(params, env) {
  if (!hasCmsPipelineBinding(env)) return missingBinding();
  const goal = String(params.goal ?? params.prompt ?? params.message ?? '').trim();
  if (!goal) return { error: 'goal required' };
  const pageId = String(params.page_id ?? params.pageId ?? '').trim() || undefined;
  const projectSlug = String(params.project_slug ?? params.projectSlug ?? params.project ?? '').trim() || undefined;
  const out = await fetchCmsPipelineJson(env, '/agent/prototype', {
    goal,
    page_id: pageId,
    project_slug: projectSlug,
    page: params.page,
    sections: params.sections,
  });
  if (out.error) return out;
  return { ok: true, ...out, agent_applied: false };
}

/**
 * @param {Record<string, unknown>} params
 * @param {any} env
 */
async function cmsPipelineExtract(params, env) {
  if (!hasCmsPipelineBinding(env)) return missingBinding();
  const html = String(params.html ?? params.content ?? '').trim();
  if (!html) return { error: 'html or content required' };
  const out = await fetchCmsPipelineJson(env, '/pipeline/extract-sections', { html });
  if (out.error) return out;
  return { ok: true, ...out };
}

/**
 * @param {Record<string, unknown>} params
 * @param {any} env
 */
async function cmsPipelineInject(params, env) {
  if (!hasCmsPipelineBinding(env)) return missingBinding();
  const shellHtml = String(params.shell_html ?? params.html ?? '').trim();
  const sectionName = String(params.section_name ?? params.sectionName ?? '').trim();
  const fragment = String(params.fragment_html ?? params.fragment ?? '').trim();
  if (!shellHtml || !sectionName || !fragment) {
    return { error: 'shell_html, section_name, and fragment_html required' };
  }
  const out = await fetchCmsPipelineJson(env, '/pipeline/inject', {
    shell_html: shellHtml,
    section_name: sectionName,
    fragment_html: fragment,
    position: params.position || 'replace',
  });
  if (out.error) return out;
  return { ok: true, ...out };
}

/**
 * @param {Record<string, unknown>} params
 * @param {any} env
 */
async function cmsPipelineBootstrap(params, env) {
  if (!hasCmsPipelineBinding(env)) return missingBinding();
  const projectSlug = String(
    params.project_slug ?? params.projectSlug ?? params.project_id ?? params.project ?? '',
  ).trim();
  if (!projectSlug) return { error: 'project_slug required' };
  const res = await fetchCmsPipeline(
    env,
    `/pipeline/bootstrap?project_slug=${encodeURIComponent(projectSlug)}`,
    { method: 'GET' },
  );
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    return { error: data?.error || res.statusText || 'cms_pipeline_error', status: res.status, body: data };
  }
  return { ok: true, ...data };
}

/**
 * @param {Record<string, unknown>} params
 * @param {any} env
 */
async function cmsPipelineThemeAudit(params, env) {
  if (!hasCmsPipelineBinding(env)) return missingBinding();
  const packageId = String(params.package_id ?? params.import_id ?? params.packageId ?? '').trim();
  if (packageId) {
    const tenantId = String(params.tenant_id ?? params.tenantId ?? '').trim() || undefined;
    return auditSitePackageById(env, tenantId, packageId);
  }
  const manifest = params.manifest && typeof params.manifest === 'object' ? params.manifest : {};
  const sections = Array.isArray(params.sections) ? params.sections : [];
  const out = await runThemePackagePythonAudit(env, {
    manifest,
    liquidSections: sections,
    projectSlug: String(params.project_slug ?? params.projectSlug ?? 'site'),
    workspaceId: String(params.workspace_id ?? params.workspaceId ?? ''),
  });
  if (!out.ok) return out;
  return { ok: true, ...out };
}

/**
 * @param {Record<string, unknown>} params
 * @param {any} env
 */
async function cmsPipelineLiquidToHtml(params, env) {
  if (!hasCmsPipelineBinding(env)) return missingBinding();
  const sectionKey = String(params.section_key ?? params.sectionKey ?? '').trim();
  const liquid = String(params.liquid_source ?? params.liquid ?? '').trim();
  if (!liquid && !params.import_id) {
    return { error: 'liquid_source or import_id required' };
  }
  if (liquid) {
    const out = await fetchCmsPipelineJson(env, '/pipeline/liquid-to-html', {
      section_key: sectionKey || 'section',
      liquid_source: liquid,
      settings: params.settings,
    });
    if (out.error) return out;
    return { ok: true, ...out };
  }
  return convertLiquidSectionsToHtml(env, {
    import_id: String(params.import_id),
    section_keys: Array.isArray(params.section_keys) ? params.section_keys : undefined,
  });
}

export const pipelineHandlers = {
  cms_pipeline_prototype: cmsPipelinePrototype,
  cms_pipeline_extract: cmsPipelineExtract,
  cms_pipeline_inject: cmsPipelineInject,
  cms_pipeline_bootstrap: cmsPipelineBootstrap,
  cms_pipeline_theme_audit: cmsPipelineThemeAudit,
  agentsam_cms_pipeline_theme_audit: cmsPipelineThemeAudit,
  cms_pipeline_liquid_to_html: cmsPipelineLiquidToHtml,
  agentsam_cms_pipeline_liquid_to_html: cmsPipelineLiquidToHtml,
};
