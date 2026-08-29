/** @typedef {'provider'|'personal'|'internal'} KeyCategory */

export const KEY_CATEGORIES = Object.freeze(new Set(['provider', 'personal', 'internal']));

export const PROVIDERS = Object.freeze(
  new Set([
    'openai',
    'anthropic',
    'google',
    'cloudflare',
    'cloudflare_r2',
    'resend',
    'cursor',
    'github',
    'supabase',
    'meshy',
    'other',
  ]),
);

export const BYOK_USER_SCOPE = 'user';

export const R2_SECRET_NAME = 'r2_s3_credentials';
export const R2_SERVICE_NAME = 'cloudflare_r2';
export const PERSONAL_SERVICE_NAME = 'personal';

/**
 * @param {string} secretId
 * @param {string} provider
 */
export function providerSecretName(secretId, provider) {
  return `provider_key:${provider}:${secretId}`;
}
export const PROVIDER_OPTIONS = Object.freeze([
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google AI' },
  { id: 'cloudflare', label: 'Cloudflare' },
  { id: 'github', label: 'GitHub' },
  { id: 'resend', label: 'Resend' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'supabase', label: 'Supabase' },
  { id: 'meshy', label: 'Meshy' },
  { id: 'other', label: 'Other' },
]);
