import { isFeatureEnabled } from '../../platform/feature-flags.js';
import { loadCatalogCapabilities } from '../catalog/model-capabilities.js';

const FLAG_KEY = 'openai_apply_patch';

export const OPENAI_APPLY_PATCH_HYBRID_INSTRUCTION = [
  'File edits (hybrid — prefer apply_patch when available):',
  '- Prefer the built-in apply_patch tool for create/update/delete of workspace files.',
  '- Keep fs_edit_file / fs_write_file as fallback when apply_patch is unavailable or a full rewrite is simpler.',
  '- Use repo-relative paths only. Do not invent absolute host paths.',
  '- Do not use shell for file edits when fs_edit_file / agentsam_github_patch can do it.',
].join('\n');

export function resolveApplyPatchCatalogModelKey(modelKey) {
  const key = modelKey == null ? '' : String(modelKey).trim();
  if (!key) return '';
  return key === 'gpt-5.6' ? 'gpt-5.6-sol' : key;
}

/** Backend-owned rollout + model capability gate for OpenAI hosted apply_patch. */
export async function resolveOpenAiApplyPatchEnabled(env, params = {}) {
  if (params.openaiApplyPatchEnabled === true) return true;
  const modelKey = resolveApplyPatchCatalogModelKey(params.modelKey || params.providerModelId);
  if (!modelKey) return false;
  const flagOn = await isFeatureEnabled(env, FLAG_KEY, {
    userId: params.userId,
    tenantId: params.tenantId,
  });
  if (!flagOn) return false;
  const capabilities = await loadCatalogCapabilities(env, modelKey);
  return capabilities?.supports_apply_patch === true;
}

export function withOpenAiApplyPatchInstructions(systemPrompt, enabled) {
  if (!enabled) return systemPrompt;
  const base = systemPrompt == null ? '' : String(systemPrompt);
  if (base.includes('File edits (hybrid — prefer apply_patch')) return base || systemPrompt;
  return base.trim()
    ? `${base.trim()}\n\n${OPENAI_APPLY_PATCH_HYBRID_INSTRUCTION}`
    : OPENAI_APPLY_PATCH_HYBRID_INSTRUCTION;
}

export function withOpenAiApplyPatchTool(tools, enabled) {
  if (!enabled) return tools;
  const out = Array.isArray(tools) ? [...tools] : [];
  if (!out.some((tool) => tool?.type === 'apply_patch')) out.push({ type: 'apply_patch' });
  return out;
}
