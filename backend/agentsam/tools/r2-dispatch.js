// backend/agentsam/tools/r2-dispatch.js
/**
 * Agent Sam: Global R2 Dispatcher
 * Orchestrates bucket-agnostic storage operations.
 */
import { jsonResponse } from '../../../src/core/auth.js';
import { detectFileKind } from '../../../src/core/file-kind.js';
import * as r2Core from '../../../src/core/r2.js';
import {
  r2AbortMultipartUpload,
  r2CompleteMultipartUpload,
  r2CreateMultipartUpload,
  r2UploadMultipartPart,
} from '../../../src/core/r2-multipart.js';
import { normalizeR2ObjectKey, RECOMMENDED_PART_SIZE } from '../../../src/core/r2-keys.js';

/**
 * Main dispatcher for R2 storage tasks.
 * Route: /api/agentsam/r2/*
 */
export async function handleR2Dispatch(request, env, ctx, authUser) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
        const body = method !== 'GET' ? await request.json() : {};
        const bucket = String(body.bucket || url.searchParams.get('bucket') || '').trim();
        const key = body.key || url.searchParams.get('key');
        if (!bucket) return jsonResponse({ error: 'bucket_required' }, 400);

        const binding = r2Core.resolveR2Access(env, bucket)?.binding || r2Core.getR2Binding(env, bucket);

        if (path.endsWith('/list')) {
            const prefix = body.prefix || url.searchParams.get('prefix') || '';
            const limit = body.limit || url.searchParams.get('limit') || 100;
            const objects = await r2Core.r2ListViaBindingOrS3(env, binding, bucket, prefix, limit);
            return jsonResponse({ bucket, prefix, objects });
        }

        if (path.endsWith('/head')) {
            if (!key) return jsonResponse({ error: 'Missing key' }, 400);
            const meta = await r2Core.r2HeadViaBindingOrS3(env, binding, bucket, key);
            if (!meta) return jsonResponse({ error: 'Object not found' }, 404);
            const fileKind = detectFileKind({ key, contentType: meta.contentType, size: meta.size });
            return jsonResponse({ bucket, ...meta, fileKind });
        }

        if (path.endsWith('/get')) {
            if (!key) return jsonResponse({ error: 'Missing key' }, 400);
            const meta = await r2Core.r2HeadViaBindingOrS3(env, binding, bucket, key);
            if (!meta) return jsonResponse({ error: 'Object not found' }, 404);
            const fileKind = detectFileKind({ key, contentType: meta.contentType, size: meta.size });
            if (fileKind !== 'text') {
                return jsonResponse({
                    bucket,
                    key,
                    fileKind,
                    contentType: meta.contentType,
                    size: meta.size,
                    binary: true,
                    hint: 'Use object GET URL for media bytes; do not decode as UTF-8 text.',
                });
            }
            const obj = await r2Core.r2GetViaBindingOrS3(env, binding, bucket, key);
            if (!obj) return jsonResponse({ error: 'Object not found' }, 404);
            const content = await obj.text();
            return jsonResponse({ bucket, key, content, fileKind: 'text' });
        }

        if (path.endsWith('/put')) {
            if (!key || body.content == null) return jsonResponse({ error: 'Missing key or content' }, 400);
            const norm = normalizeR2ObjectKey(key, { allowAnyPrefix: true });
            if (!norm.ok) return jsonResponse({ error: norm.error }, 400);
            const payload =
                typeof body.content === 'string'
                    ? new TextEncoder().encode(body.content)
                    : body.content;
            const success = await r2Core.r2PutViaBindingOrS3(
                env,
                binding,
                bucket,
                norm.key,
                payload,
                body.contentType,
            );
            return jsonResponse({ bucket, key: norm.key, success });
        }

        if (path.endsWith('/delete')) {
            if (!key) return jsonResponse({ error: 'Missing key' }, 400);
            const success = await r2Core.r2DeleteViaBindingOrS3(env, binding, bucket, key);
            return jsonResponse({ bucket, key, success });
        }

        if (path.endsWith('/delete-batch')) {
            const keys = Array.isArray(body.keys) ? body.keys : [];
            if (!keys.length) return jsonResponse({ error: 'Missing keys array' }, 400);
            const result = await r2Core.r2DeleteManyViaBindingOrS3(env, binding, bucket, keys);
            return jsonResponse({ bucket, deleted: result.deleted, errors: result.errors });
        }

        if (path.endsWith('/multipart/create')) {
            if (!key) return jsonResponse({ error: 'Missing key' }, 400);
            const norm = normalizeR2ObjectKey(key, { allowAnyPrefix: true });
            if (!norm.ok) return jsonResponse({ error: norm.error }, 400);
            const created = await r2CreateMultipartUpload(
                env,
                binding,
                bucket,
                norm.key,
                body.contentType || 'application/octet-stream',
            );
            if (created.error) return jsonResponse({ error: created.error }, 500);
            return jsonResponse({
                bucket,
                key: norm.key,
                uploadId: created.uploadId,
                recommendedPartSize: RECOMMENDED_PART_SIZE,
            });
        }

        if (path.endsWith('/multipart/part')) {
            const uploadId = body.uploadId || url.searchParams.get('uploadId');
            const partNumber = body.partNumber || url.searchParams.get('partNumber');
            if (!key || !uploadId || !partNumber) {
                return jsonResponse({ error: 'key, uploadId, partNumber required' }, 400);
            }
            const buf =
                body.partBase64 != null
                    ? Uint8Array.from(atob(body.partBase64), (c) => c.charCodeAt(0)).buffer
                    : new Uint8Array(0).buffer;
            const part = await r2UploadMultipartPart(env, binding, bucket, key, uploadId, partNumber, buf);
            if (!part.ok) return jsonResponse({ error: part.error }, 500);
            return jsonResponse(part);
        }

        if (path.endsWith('/multipart/complete')) {
            const uploadId = body.uploadId;
            const parts = body.parts;
            if (!key || !uploadId || !Array.isArray(parts)) {
                return jsonResponse({ error: 'key, uploadId, parts required' }, 400);
            }
            const done = await r2CompleteMultipartUpload(env, binding, bucket, key, uploadId, parts);
            if (!done.ok) return jsonResponse({ error: done.error }, 500);
            return jsonResponse({ bucket, key, ok: true, etag: done.etag });
        }

        if (path.endsWith('/multipart/abort')) {
            const uploadId = body.uploadId;
            if (!key || !uploadId) return jsonResponse({ error: 'key, uploadId required' }, 400);
            const aborted = await r2AbortMultipartUpload(env, binding, bucket, key, uploadId);
            return jsonResponse({ ok: aborted.ok, aborted: aborted.aborted });
        }

        return jsonResponse({ error: 'R2 action not found' }, 404);

    } catch (e) {
        console.error('[R2 Dispatch Error]', e.message);
        return jsonResponse({ error: 'Dispatcher failed', detail: e.message }, 500);
    }
}
