/**
 * Compatibility layer for the retired hardcoded CMS site-spine map.
 * Runtime identity now comes from authoritative site/client-app configuration.
 */
import {
  buildCmsRuntimeDescriptor,
  formatCmsRuntimeDescriptorForPrompt,
} from './agentsam/cms/runtime/descriptor.js';

/** @deprecated Hardcoded site code spines were removed. */
export function getCmsCodeSpine() {
  return null;
}

export function buildAgentSiteContext(appKey, siteConfig = null, pageFocus = null) {
  const cfg = siteConfig && typeof siteConfig === 'object' ? { ...siteConfig } : {};
  if (!cfg.app_key && appKey) cfg.app_key = String(appKey);
  if (!cfg.project_slug && appKey) cfg.project_slug = String(appKey);
  return buildCmsRuntimeDescriptor(cfg, pageFocus);
}

export function formatAgentSiteContextForPrompt(ctx) {
  return formatCmsRuntimeDescriptorForPrompt(ctx);
}
