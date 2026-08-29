/**
 * Worker front-door auth policy.
 *
 * This is request-lifecycle policy, not domain authorization. It only decides
 * whether the Worker may require browser/session identity before dispatch.
 * Route handlers still own their own authorization and machine-secret gates.
 */

export const PUBLIC_OAUTH_PATHS = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
  '/.well-known/jwks.json',
  '/api/oauth',
  '/auth/login',
  '/auth/signup',
  '/auth/reset',
  '/auth/company-branding.js',
  '/shared/company-branding.js',
  '/auth/callback/google',
  '/auth/callback/github',
  '/auth/callback/supabase',
  '/api/auth/supabase/callback',
  '/api/auth/oauth/consent',
  '/oauth/consent',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/backup-code',
  '/api/auth/recovery',
  '/api/auth/password-reset',
  '/api/auth/reset',
  '/api/auth/forgot-password',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth-hooks',
  '/api/auth/google/start',
  '/api/auth/github/start',
  '/api/auth/supabase/start',
  '/api/company',
  '/api/health',
  '/api/system/health',
  '/health',
  '/',
  '/work',
  '/about',
  '/services',
  '/contact',
  '/pricing',
  '/terms',
  '/privacy',
  '/games',
  '/marketing',
  '/learn',
  '/start',
  '/api/public/cms',
  '/api/games',
  '/api/webhooks/openai',
  '/api/hooks/openai',
  '/api/webhooks/github',
  '/api/webhooks/anthropic',
  '/api/webhooks/cursor',
  '/api/webhooks/internal',
  '/api/webhooks/cloudflare',
  '/api/webhooks/realtimekit',
  '/api/webhooks/supabase',
  '/api/hooks/supabase',
  '/api/webhooks/stripe',
  '/api/webhooks/resend',
  '/api/email/inbound',
  '/api/integrations/resend/webhook',
  '/api/webhooks/stream/vod',
  '/api/webhooks/stream/live',
  '/api/webhooks/cloudconvert',
  '/api/webhooks/meshy',
  '/assets/glb',
  '/assets/scenes',
  '/assets/marketing',
  '/static/frontend/games/games-room.js',
  '/static/dashboard/app/cms',
  '/globe',
  '/manifest.webmanifest',
  '/sw.js',
  '/push-handler.js',
  '/sw-agent-cache.js',
  '/offline.html',
  '/pwa-build-meta.json',
  '/static/dashboard/manifest.webmanifest',
  '/static/dashboard/app/manifest.webmanifest',
  '/static/dashboard/sw.js',
  '/static/dashboard/app/pwa',
];

export function isPublicWorkboxPath(pathname) {
  const base = String(pathname || '').split('/').pop() || '';
  return /^workbox-[a-f0-9]+\.js$/i.test(base);
}

export function isPublicOAuthPath(pathname) {
  const p = String(pathname || '/').replace(/\/$/, '') || '/';
  const pl = p.toLowerCase();
  if (isPublicWorkboxPath(pl)) return true;
  return PUBLIC_OAUTH_PATHS.some((pub) => {
    const pubL = pub.toLowerCase();
    return pl === pubL || pl.startsWith(`${pubL}/`);
  });
}

export function publicOAuthRequestContext() {
  return { identity: null, auth: null, publicRoute: true, error: 'unauthenticated' };
}

export function isAutomationApiPath(pathname, method = 'GET') {
  const p = String(pathname || '/').replace(/\/$/, '') || '/';
  const m = String(method || 'GET').toUpperCase();
  if (p.startsWith('/api/internal/')) return true;
  if (p === '/api/agent/routing/apply-eto' && m === 'POST') return true;
  if (p === '/api/email/send' && m === 'POST') return true;
  if (p === '/api/push/notify' && m === 'POST') return true;
  if (p === '/api/push/action' && m === 'POST') return true;
  if (p === '/api/auth/agent-session/mint' && m === 'POST') return true;
  if (p === '/api/sdk/auth/start' && m === 'POST') return true;
  if (p === '/api/sdk/auth/exchange' && m === 'POST') return true;
  if (p === '/api/sdk/auth/authorize' && m === 'GET') return true;
  if (p === '/api/test/code-execution-e2e' && m === 'POST') return true;
  if (/^\/api\/projects\/[^/]+\/runtime-contract\/sync$/i.test(p) && m === 'POST') return true;
  return false;
}

export function isCmsPreviewAuthBypass(url, method = 'GET') {
  const m = String(method || 'GET').toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return false;
  const cmsEmbed = url?.searchParams?.get('cms') === '1';
  const preview = String(url?.searchParams?.get('preview') || '').trim().toLowerCase();
  return cmsEmbed || preview === 'draft' || preview === 'published' || preview === 'live' || preview === '1' || preview === 'true';
}

/**
 * @returns {'none'|'soft'|'optional'|'required'}
 * none: handler proves identity itself; do not prime session middleware.
 * soft: opportunistically prime auth, but never block the route on auth failure.
 * optional: resolve browser identity if present; missing identity is valid.
 * required: protected API path.
 */
export function workerAuthMode({ url, pathLower, methodUpper }) {
  if (pathLower === '/api/auth/me' && methodUpper === 'GET') return 'none';
  if (
    isPublicOAuthPath(pathLower) ||
    isAutomationApiPath(pathLower, methodUpper) ||
    isCmsPreviewAuthBypass(url, methodUpper)
  ) {
    return 'soft';
  }
  if ((methodUpper === 'GET' || methodUpper === 'HEAD') && !pathLower.startsWith('/api/')) {
    return 'optional';
  }
  return 'required';
}


export function isCmsStudioHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  return host === 'studio.inneranimalmedia.com' || host === 'www.studio.inneranimalmedia.com';
}

export function isWorkerHtmlAuthShell(url, pathLower) {
  if (
    pathLower === '/dashboard' ||
    pathLower.startsWith('/dashboard/') ||
    pathLower === '/onboarding' ||
    pathLower.startsWith('/onboarding/')
  ) {
    return true;
  }

  const studioAlias =
    pathLower === '/studio' ||
    pathLower === '/studio/editor' ||
    pathLower === '/studio/pages' ||
    pathLower.startsWith('/studio/pages/') ||
    pathLower === '/studio/theme-editor';
  if (studioAlias) return true;

  if (!isCmsStudioHost(url?.hostname)) return false;
  return (
    pathLower === '/' ||
    pathLower === '/editor' ||
    pathLower === '/pages' ||
    pathLower.startsWith('/pages/') ||
    pathLower === '/theme-editor'
  );
}
