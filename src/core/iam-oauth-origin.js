/**
 * Canonical public origin for IAM Google/GitHub login OAuth redirect_uri values.
 * Google requires an exact redirect_uri match — www vs apex breaks login if only one is registered.
 */

const IAM_APEX_ORIGIN = 'https://inneranimalmedia.com';

/**
 * @param {URL | Request | string | null | undefined} urlOrRequest
 * @returns {string}
 */
export function canonicalIamPublicOrigin(urlOrRequest) {
  let origin = IAM_APEX_ORIGIN;
  try {
    if (urlOrRequest instanceof Request) {
      origin = new URL(urlOrRequest.url).origin;
    } else if (urlOrRequest instanceof URL) {
      origin = urlOrRequest.origin;
    } else if (typeof urlOrRequest === 'string' && urlOrRequest.trim()) {
      origin = new URL(urlOrRequest.trim()).origin;
    }
    const host = new URL(origin).hostname.toLowerCase();
    if (host === 'inneranimalmedia.com' || host === 'www.inneranimalmedia.com') {
      return IAM_APEX_ORIGIN;
    }
    return new URL(origin).origin;
  } catch {
    return IAM_APEX_ORIGIN;
  }
}

/** Google sign-in (dashboard login) — must match Google Cloud authorized redirect URIs. */
export function googleLoginOAuthRedirectUri(urlOrRequest) {
  return `${canonicalIamPublicOrigin(urlOrRequest)}/auth/callback/google`;
}

/** GitHub sign-in uses /api/oauth/github/callback (registered on the GitHub OAuth app). */
export function githubLoginOAuthRedirectUri(urlOrRequest) {
  return `${canonicalIamPublicOrigin(urlOrRequest)}/api/oauth/github/callback`;
}
