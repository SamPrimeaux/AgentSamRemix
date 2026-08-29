/**
 * Client mirror of src/core/integration-brand-avatars.js.
 * Never use /assets/integrations/*.svg paths.
 *
 * Resolution order: catalog → registry → map → prefix fallback → null.
 */

const CF = 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/8e623df0-6bd7-4314-87c3-8b377e53e700/avatar';
const IAM = 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/0b4355d1-1883-4819-0c62-cdd1d6289f00/avatar';
const SB = 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/cedec69a-4847-4cec-d4e3-e3dbb5619900/avatar';
const GDRIVE = 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/c7d1b46f-9614-49d7-19d9-d1c8d2d77500/avatar';
const GMAIL = 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/45164248-52e4-4bd0-d654-72ab6002b900/avatar';

const INTEGRATION_BRAND_AVATARS: Record<string, string> = {
  cloudflare: CF,
  cloudflare_oauth: CF,
  cloudflare_r2: CF,
  cloudflare_images: CF,
  cloudflare_kv: CF,
  cloudflare_d1: CF,
  cloudflare_do: CF,
  cloudflare_workers: CF,
  cloudflare_pages: CF,
  cloudflare_tunnel: CF,
  cloudflare_stream: CF,
  cloudflare_ai: CF,
  vectorize: CF,
  hyperdrive: SB,
  browser_rendering: CF,
  agentsam: IAM,
  agentsam_sdk: IAM,
  mcp: IAM,
  mcp_servers: IAM,
  local_tunnel: IAM,
  local_machine: IAM,
  inneranimalmedia_mcp_server: IAM,
  'inneranimalmedia-mcp-server': IAM,
  iam_mcp_platform: IAM,
  autodidact: IAM,
  claude_code: 'https://anthropic.com/favicon.ico',
  claude_code_cli: 'https://anthropic.com/favicon.ico',
  supabase: SB,
  supabase_oauth: SB,
  google_drive: GDRIVE,
  google_gmail: GMAIL,
  gmail: GMAIL,
  google_calendar: 'https://www.google.com/s2/favicons?domain=calendar.google.com&sz=64',
  google_ai: 'https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg',
  google_meet: 'https://www.google.com/s2/favicons?domain=meet.google.com&sz=64',
  github: 'https://github.githubassets.com/assets/GitHub-Mark-ea2971cee799.png',
  stripe: 'https://js.stripe.com/v3/fingerprinted/img/favicon-32x32-e6d5e0dc.png',
  resend: 'https://resend.com/static/brand/resend-icon-black.png',
  anthropic: 'https://anthropic.com/favicon.ico',
  openai: 'https://openai.com/favicon.ico',
  cursor: 'https://www.cursor.com/favicon.ico',
  bluebubbles: 'https://bluebubbles.app/img/logo/logo.png',
};

export function resolveIntegrationIconUrl(
  providerKey?: string | null,
  catalogIconUrl?: string | null,
  catalogSlug?: string | null,
  registryIconUrl?: string | null,
): string | null {
  const fromCatalog = String(catalogIconUrl || '').trim();
  const fromRegistry = String(registryIconUrl || '').trim();
  if (fromRegistry && fromRegistry !== fromCatalog) return fromRegistry;
  if (fromCatalog) return fromCatalog;
  if (fromRegistry) return fromRegistry;

  const pk = String(providerKey || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (INTEGRATION_BRAND_AVATARS[pk]) return INTEGRATION_BRAND_AVATARS[pk];

  const slug = String(catalogSlug || '').trim().toLowerCase();
  if (slug && INTEGRATION_BRAND_AVATARS[slug]) return INTEGRATION_BRAND_AVATARS[slug];
  const slugUnder = slug.replace(/-/g, '_');
  if (slugUnder && INTEGRATION_BRAND_AVATARS[slugUnder]) return INTEGRATION_BRAND_AVATARS[slugUnder];

  if (pk.startsWith('cloudflare_') || pk.startsWith('cf_')) return INTEGRATION_BRAND_AVATARS.cloudflare;
  if (pk.startsWith('google_')) return INTEGRATION_BRAND_AVATARS.google_drive;

  return null;
}
