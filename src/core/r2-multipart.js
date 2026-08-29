/**
 * R2 multipart upload — binding-first, S3 SigV4 fallback.
 */
import { r2ObjectPathForS3, signR2Request } from './r2.js';
import { escapeXmlText } from './r2-xml.js';
import { RECOMMENDED_PART_SIZE } from './r2-keys.js';

export { RECOMMENDED_PART_SIZE };

/**
 * @param {object} env
 * @param {R2Bucket|null} binding
 * @param {string} s3BucketName
 * @param {string} key
 * @param {string} contentType
 * @param {Record<string,string>} [metadata]
 */
export async function r2CreateMultipartUpload(env, binding, s3BucketName, key, contentType, metadata = {}) {
  const ct = contentType || 'application/octet-stream';
  if (binding?.createMultipartUpload) {
    const upload = await binding.createMultipartUpload(key, {
      httpMetadata: { contentType: ct },
      customMetadata: metadata,
    });
    return { uploadId: upload.uploadId, bindingUpload: upload };
  }

  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return { error: 'no_binding_or_credentials' };
  }

  const path = r2ObjectPathForS3(key);
  const query = 'uploads=';
  const signed = await signR2Request('POST', s3BucketName, path, query, env, {
    body: '',
    contentType: ct,
    extraHeaders: metadata['x-amz-meta-source']
      ? { 'x-amz-meta-source': metadata['x-amz-meta-source'] }
      : {},
  });
  if (!signed) return { error: 'sign_failed' };

  const res = await fetch(signed.endpoint, { method: 'POST', headers: signed.headers });
  if (!res.ok) {
    const t = await res.text();
    return { error: `create_multipart_${res.status}`, detail: t.slice(0, 300) };
  }
  const xml = await res.text();
  const uploadId = (xml.match(/<UploadId>([^<]*)<\/UploadId>/) || [])[1];
  if (!uploadId) return { error: 'missing_upload_id' };
  return { uploadId, s3: true };
}

/**
 * @param {object} env
 * @param {R2Bucket|null} binding
 * @param {string} s3BucketName
 * @param {string} key
 * @param {string} uploadId
 * @param {number} partNumber
 * @param {ArrayBuffer|Uint8Array} body
 * @param {object} [opts] bindingUpload from create
 */
export async function r2UploadMultipartPart(
  env,
  binding,
  s3BucketName,
  key,
  uploadId,
  partNumber,
  body,
  opts = {},
) {
  const pn = Math.max(1, Math.min(10000, Number(partNumber) || 1));
  const bytes = body instanceof ArrayBuffer ? body : body.buffer?.slice?.(body.byteOffset, body.byteOffset + body.byteLength) ?? body;

  if (opts.bindingUpload?.uploadPart) {
    const part = await opts.bindingUpload.uploadPart(pn, bytes);
    const etag = part?.etag || part?.httpEtag || '';
    return { ok: true, partNumber: pn, etag, size: bytes.byteLength };
  }

  if (binding?.resumeMultipartUpload) {
    const upload = binding.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(pn, bytes);
    const etag = part?.etag || part?.httpEtag || '';
    return { ok: true, partNumber: pn, etag, size: bytes.byteLength, bindingUpload: upload };
  }

  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return { ok: false, error: 'no_binding_or_credentials' };
  }

  const path = r2ObjectPathForS3(key);
  const query = `partNumber=${pn}&uploadId=${encodeURIComponent(uploadId)}`;
  const signed = await signR2Request('PUT', s3BucketName, path, query, env, {
    body: bytes,
    contentType: 'application/octet-stream',
  });
  if (!signed) return { ok: false, error: 'sign_failed' };

  const res = await fetch(signed.endpoint, {
    method: 'PUT',
    headers: signed.headers,
    body: signed.bodyBytes.byteLength ? signed.bodyBytes : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: `upload_part_${res.status}`, detail: t.slice(0, 300) };
  }
  const etag = res.headers.get('etag') || '';
  return { ok: true, partNumber: pn, etag, size: bytes.byteLength };
}

/**
 * @param {Array<{partNumber:number, etag:string}>} parts
 */
export async function r2CompleteMultipartUpload(
  env,
  binding,
  s3BucketName,
  key,
  uploadId,
  parts,
  opts = {},
) {
  const sorted = [...parts]
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag || '').trim() }))
    .filter((p) => p.partNumber > 0 && p.etag)
    .sort((a, b) => a.partNumber - b.partNumber);

  if (!sorted.length) return { ok: false, error: 'no_parts' };

  if (opts.bindingUpload?.complete) {
    await opts.bindingUpload.complete(sorted);
    return { ok: true, etag: null };
  }

  if (binding?.resumeMultipartUpload) {
    const upload = binding.resumeMultipartUpload(key, uploadId);
    await upload.complete(sorted);
    return { ok: true, etag: null };
  }

  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return { ok: false, error: 'no_binding_or_credentials' };
  }

  const partsXml = sorted
    .map(
      (p) =>
        `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXmlText(p.etag)}</ETag></Part>`,
    )
    .join('');
  const body = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;
  const path = r2ObjectPathForS3(key);
  const query = `uploadId=${encodeURIComponent(uploadId)}`;
  const signed = await signR2Request('POST', s3BucketName, path, query, env, {
    body,
    contentType: 'application/xml',
  });
  if (!signed) return { ok: false, error: 'sign_failed' };

  const res = await fetch(signed.endpoint, {
    method: 'POST',
    headers: signed.headers,
    body: signed.bodyBytes.byteLength ? signed.bodyBytes : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: `complete_multipart_${res.status}`, detail: t.slice(0, 300) };
  }
  const xml = await res.text();
  const etag = (xml.match(/<ETag>([^<]*)<\/ETag>/) || [])[1] || res.headers.get('etag');
  return { ok: true, etag };
}

export async function r2AbortMultipartUpload(env, binding, s3BucketName, key, uploadId, opts = {}) {
  if (opts.bindingUpload?.abort) {
    await opts.bindingUpload.abort();
    return { ok: true, aborted: true };
  }

  if (binding?.resumeMultipartUpload) {
    const upload = binding.resumeMultipartUpload(key, uploadId);
    await upload.abort();
    return { ok: true, aborted: true };
  }

  if (!s3BucketName || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return { ok: false, error: 'no_binding_or_credentials' };
  }

  const path = r2ObjectPathForS3(key);
  const query = `uploadId=${encodeURIComponent(uploadId)}`;
  const signed = await signR2Request('DELETE', s3BucketName, path, query, env);
  if (!signed) return { ok: false, error: 'sign_failed' };

  const res = await fetch(signed.endpoint, { method: 'DELETE', headers: signed.headers });
  if (!res.ok && res.status !== 404) {
    return { ok: false, error: `abort_multipart_${res.status}` };
  }
  return { ok: true, aborted: true };
}
