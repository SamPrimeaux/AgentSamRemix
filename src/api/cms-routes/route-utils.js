import { cmsR2PublicObjectUrl } from '../../core/agentsam/cms/adapters/cloudflare/storage.js';

export function cmsPathSegment(value, fallback = 'section') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

export async function cmsContentSha256(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input ?? '')));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function cmsSectionHtmlKey(pageSlug, sectionName, hash) {
  return `cms/sections/${cmsPathSegment(pageSlug, 'page')}/${cmsPathSegment(sectionName)}/${hash}.html`;
}

export function cmsR2PublicUrlFromRequest(request, bucket, key) {
  const direct = cmsR2PublicObjectUrl(bucket, key);
  if (direct) return direct;
  const origin = new URL(request.url).origin;
  return `${origin}/api/r2/buckets/${encodeURIComponent(bucket)}/object/${encodeURIComponent(key)}`;
}

export function cmsMutationMeta(authUser, request) {
  const routeKey = request.headers.get('x-iam-route-key') || request.headers.get('X-IAM-Route-Key') || '';
  return { userId: authUser.id, routeKey: String(routeKey || '').trim(), agentApplied: routeKey === 'cms_edit' };
}

export async function presignR2GetObjectUrl(env, bucket, key, expiresSeconds = 3600) {
  const accessKey = env.R2_ACCESS_KEY_ID, secretKey = env.R2_SECRET_ACCESS_KEY, accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!accessKey || !secretKey || !accountId) return null;
  const host = `${accountId}.r2.cloudflarestorage.com`, now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8), region = 'auto', service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const encodedKey = String(key).split('/').map((seg) => encodeURIComponent(seg)).join('/');
  const params = new URLSearchParams({ 'X-Amz-Algorithm':'AWS4-HMAC-SHA256','X-Amz-Credential':`${accessKey}/${credentialScope}`,'X-Amz-Date':amzDate,'X-Amz-Expires':String(expiresSeconds),'X-Amz-SignedHeaders':'host' });
  const canonicalQueryString = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const canonicalHeaders = `host:${host}\n`, signedHeaders = 'host';
  const sha256 = async (msg) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg)))).map((b)=>b.toString(16).padStart(2,'0')).join('');
  const hmac = async (keyValue,msg) => {
    const cryptoKey = await crypto.subtle.importKey('raw', typeof keyValue === 'string' ? new TextEncoder().encode(keyValue) : keyValue, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(msg)));
  };
  const canonicalRequest = ['GET',`/${bucket}/${encodedKey}`,canonicalQueryString,canonicalHeaders,signedHeaders,'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256',amzDate,credentialScope,await sha256(canonicalRequest)].join('\n');
  const kDate=await hmac(`AWS4${secretKey}`,dateStamp), kRegion=await hmac(kDate,region), kService=await hmac(kRegion,service), signingKey=await hmac(kService,'aws4_request');
  const signature=Array.from(await hmac(signingKey,stringToSign)).map((b)=>b.toString(16).padStart(2,'0')).join('');
  return `https://${host}/${bucket}/${encodedKey}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export function cmsMarketingSlugSuffix(len = 6) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function cmsPageKey(workspaceId, projectId, slug, variant) {
  return `cms/${workspaceId}/${projectId}/${slug}/${variant}.html`;
}
