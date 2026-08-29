/** Provider-neutral CMS AI request/result contracts. */
export function assertCmsAiProvider(provider) {
  if (!provider || typeof provider.complete !== 'function') throw new Error('cms_ai_provider_complete_required');
  return provider;
}

export function normalizeCmsAiModel(model = {}) {
  return Object.freeze({
    model_key: String(model.model_key ?? model.modelKey ?? '').trim() || null,
    provider: String(model.provider ?? '').trim() || null,
    api_platform: String(model.api_platform ?? model.apiPlatform ?? '').trim() || null,
  });
}
