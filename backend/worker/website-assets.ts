/**
 * WEBSITE_ASSETS (R2) browser-shell responder.
 *
 * Payloads are immutable content-addressed objects. `current.json` is the one
 * mutable promotion pointer and contains the logical-key -> immutable-object map.
 * This keeps HTML releases atomic while allowing unchanged payloads to be reused
 * across releases without re-uploading bytes.
 */

type WebsiteAssetRecord = {
  key: string;
  sha256: string;
  bytes: number;
  content_type: string;
  cache_control: string;
};

type WebsiteAssetPointer = {
  schema: 'iam.website-assets.current.v1';
  version: 1;
  release: string;
  manifest: string;
  promoted_at: string;
  commit?: string | null;
  dirty?: boolean;
  previous_release?: string | null;
  objects: Record<string, WebsiteAssetRecord>;
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

async function readPointer(bucket: R2Bucket): Promise<WebsiteAssetPointer | null> {
  const object = await bucket.get('current.json');
  if (!object) return null;
  try {
    const parsed = JSON.parse(await object.text()) as WebsiteAssetPointer;
    if (
      parsed?.schema !== 'iam.website-assets.current.v1' ||
      parsed?.version !== 1 ||
      !parsed.release ||
      !parsed.objects ||
      typeof parsed.objects !== 'object'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function etagFor(record: WebsiteAssetRecord): string {
  return `"sha256-${record.sha256}"`;
}

function requestHasEtag(request: Request, etag: string): boolean {
  const value = request.headers.get('If-None-Match');
  if (!value) return false;
  return value
    .split(',')
    .map((part) => part.trim())
    .some((part) => part === etag || part === '*');
}

function responseHeaders(
  object: R2ObjectBody,
  record: WebsiteAssetRecord,
  release: string,
): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', record.content_type || 'application/octet-stream');
  headers.set('Cache-Control', record.cache_control || 'public, max-age=0, must-revalidate');
  headers.set('ETag', etagFor(record));
  headers.set('X-IAM-Content-SHA256', record.sha256);
  headers.set('X-IAM-Website-Release', release);
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

  const pointer = await readPointer(bucket);
  if (!pointer) {
    return new Response('website_release_unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const url = new URL(request.url);
  const candidates = options.key
    ? [cleanKey(options.key)].filter((key): key is string => Boolean(key))
    : requestCandidates(url.pathname, options.spaFallback === true);

  for (const logicalKey of candidates) {
    const record = pointer.objects[logicalKey];
    if (!record) continue;

    const etag = etagFor(record);
    if (requestHasEtag(request, etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': record.cache_control || 'public, max-age=0, must-revalidate',
          'X-IAM-Content-SHA256': record.sha256,
          'X-IAM-Website-Release': pointer.release,
        },
      });
    }

    const object = await bucket.get(record.key);
    if (!object) {
      return new Response('website_release_object_missing', {
        status: 502,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-IAM-Website-Release': pointer.release,
        },
      });
    }
    return new Response(request.method === 'HEAD' ? null : object.body, {
      status: 200,
      headers: responseHeaders(object, record, pointer.release),
    });
  }

  return new Response('not_found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-IAM-Website-Release': pointer.release,
    },
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
