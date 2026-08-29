/** Provider credential seam. Secrets are read from Worker bindings only here. */
export function resolveProviderApiKey(env, provider, secretKeyName = null) {
  const p = String(provider || '').trim().toLowerCase();
  const names = [
    secretKeyName,
    p === 'deepseek' ? 'AGENTSAM_DEEPSEEK' : null,
    p === 'openai' ? 'OPENAI_API_KEY' : null,
    p === 'anthropic' ? 'ANTHROPIC_API_KEY' : null,
    p === 'google' ? 'GOOGLE_AI_API_KEY' : null,
    p === 'cursor' ? 'CURSOR_API_KEY' : null,
  ].filter(Boolean);
  for (const name of names) {
    const value = env?.[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

export function providerBaseUrl(provider, options = {}) {
  const p = String(provider || '').trim().toLowerCase();
  if (p === 'deepseek') {
    return options.deepseekBeta === true || options.deepseekStrictTools === true
      ? 'https://api.deepseek.com/beta'
      : 'https://api.deepseek.com';
  }
  return 'https://api.openai.com/v1';
}
