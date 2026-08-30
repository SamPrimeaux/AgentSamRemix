/**
 * WEBSITE_ASSETS (R2) browser-shell responder.
 *
 * The compiled JS/CSS bundle can still be delivered by Cloudflare Workers Assets,
 * but HTML authority and Worker-side fallbacks live in the real R2 bucket. Keep
 * this adapter narrow: resolve authored shell objects, never application behavior.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function extensionOf(key: string): string {
  const slash = key.lastIndexOf('/');
  const dot = key.lastIndexOf('.');
  return dot > slash ? key.slice(dot).toLowerCase() : '';
}

function cleanKey(value: string): string | null {
  let key = String(value || '').replace(/^\/+/, '');
  try {
    key = decodeURIComponent(key);
  } catch {
    return null;
  }
  if (!key || key.includes('..') || key.includes('\\') || key.includes('\0')) return null;
  return key;
}

function requestCandidates(pathname: string, spaFallback: boolean): string[] {
  const path = pathname.startsWith('/website-assets/')
    ? pathname.slice('/website-assets/'.length)
    : pathname.replace(/^\/+/, '');

  const direct = cleanKey(path);
  const candidates: string[] = [];
  if (direct) candidates.push(direct);

  // Identity SDK asks for extensionless auth assets and /dashboard/index.html.
  if (direct === 'dashboard/index.html') candidates.unshift('index.html');
  if (direct && !extensionOf(direct)) candidates.push(`${direct}.html`);

  if (spaFallback) candidates.push('index.html');
  return [...new Set(candidates)];
}

function responseHeaders(object: R2ObjectBody, key: string): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', CONTENT_TYPES[extensionOf(key)] || 'application/octet-stream');
  }
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (!headers.has('Cache-Control')) {
    headers.set(
      'Cache-Control',
      key.endsWith('.html') ? 'public, max-age=0, must-revalidate' : 'public, max-age=300',
    );
  }
  return headers;
}

export async function fetchWebsiteAsset(
  bucket: R2Bucket | undefined,
  request: Request,
  options: { spaFallback?: boolean; key?: string } = {},
): Promise<Response> {
  if (!bucket) return new Response('WEBSITE_ASSETS unavailable', { status: 503 });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method_not_allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const candidates = options.key
    ? [cleanKey(options.key)].filter((key): key is string => Boolean(key))
    : requestCandidates(url.pathname, options.spaFallback === true);

  for (const key of candidates) {
    const object = await bucket.get(key);
    if (!object) continue;
    return new Response(request.method === 'HEAD' ? null : object.body, {
      status: 200,
      headers: responseHeaders(object, key),
    });
  }

  return new Response('not_found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** Fetcher-shaped facade expected by the identity SDK's auth HTML router. */
export function websiteAssetsFetcher(bucket: R2Bucket | undefined): { fetch(request: Request): Promise<Response> } {
  return {
    fetch(request: Request) {
      return fetchWebsiteAsset(bucket, request, { spaFallback: false });
    },
  };
}
