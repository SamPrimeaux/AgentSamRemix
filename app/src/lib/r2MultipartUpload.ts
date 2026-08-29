/** Client-side R2 multipart upload (Worker-authenticated; no secret keys in browser). */

const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const MIN_PART_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT = 4;
const MAX_PART_RETRIES = 3;

export type MultipartUploadProgress = {
  phase: 'preparing' | 'uploading' | 'retrying' | 'finalizing' | 'complete' | 'failed' | 'aborted';
  partIndex?: number;
  partTotal?: number;
  bytesUploaded?: number;
  bytesTotal?: number;
  message?: string;
};

export type MultipartUploadOptions = {
  bucket: string;
  key: string;
  file: File;
  contentType?: string;
  partSize?: number;
  onProgress?: (p: MultipartUploadProgress) => void;
  signal?: AbortSignal;
};

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function uploadFileToR2(opts: MultipartUploadOptions): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { bucket, key, file, onProgress, signal } = opts;
  const contentType = opts.contentType || file.type || 'application/octet-stream';

  if (file.size <= MULTIPART_THRESHOLD) {
    onProgress?.({ phase: 'uploading', bytesUploaded: 0, bytesTotal: file.size, message: 'Single upload' });
    const fd = new FormData();
    fd.set('bucket', bucket);
    fd.set('key', key);
    fd.set('file', file);
    const res = await fetch('/api/r2/upload', { method: 'POST', credentials: 'same-origin', body: fd, signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      onProgress?.({ phase: 'failed', message: data.error || res.statusText });
      return { ok: false, error: data.error || res.statusText };
    }
    onProgress?.({ phase: 'complete', bytesUploaded: file.size, bytesTotal: file.size });
    return { ok: true, url: data.url };
  }

  onProgress?.({ phase: 'preparing', message: 'Creating multipart upload' });
  const createRes = await fetch('/api/r2/multipart/create', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, key, contentType, metadata: { source: 'dashboard' } }),
    signal,
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created.uploadId) {
    onProgress?.({ phase: 'failed', message: created.error || 'create failed' });
    return { ok: false, error: created.error || 'multipart create failed' };
  }

  const uploadId = String(created.uploadId);
  const partSize = Math.max(
    MIN_PART_SIZE,
    opts.partSize || created.recommendedPartSize || DEFAULT_PART_SIZE,
  );
  const partCount = Math.ceil(file.size / partSize);
  const parts: Array<{ partNumber: number; etag: string }> = [];
  let bytesUploaded = 0;

  const uploadPart = async (partNumber: number) => {
    const start = (partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const chunk = file.slice(start, end);
    let lastErr = 'upload failed';
    for (let attempt = 1; attempt <= MAX_PART_RETRIES; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt > 1) {
        onProgress?.({
          phase: 'retrying',
          partIndex: partNumber,
          partTotal: partCount,
          bytesUploaded,
          bytesTotal: file.size,
          message: `Retrying part ${partNumber} (${attempt}/${MAX_PART_RETRIES})`,
        });
        await sleep(400 * attempt);
      }
      const qs = new URLSearchParams({
        bucket,
        key,
        uploadId,
        partNumber: String(partNumber),
      });
      const res = await fetch(`/api/r2/multipart/part?${qs}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk,
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.etag) {
        parts.push({ partNumber, etag: String(data.etag) });
        bytesUploaded += chunk.size;
        onProgress?.({
          phase: 'uploading',
          partIndex: partNumber,
          partTotal: partCount,
          bytesUploaded,
          bytesTotal: file.size,
          message: `Uploaded part ${partNumber} / ${partCount}`,
        });
        return;
      }
      lastErr = data.error || res.statusText;
    }
    throw new Error(lastErr);
  };

  try {
    const queue = Array.from({ length: partCount }, (_, i) => i + 1);
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, partCount) }, async () => {
      while (queue.length) {
        const pn = queue.shift();
        if (pn == null) break;
        await uploadPart(pn);
      }
    });
    await Promise.all(workers);

    onProgress?.({ phase: 'finalizing', message: 'Completing multipart upload' });
    const completeRes = await fetch('/api/r2/multipart/complete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, key, uploadId, parts }),
      signal,
    });
    const done = await completeRes.json().catch(() => ({}));
    if (!completeRes.ok) {
      onProgress?.({ phase: 'failed', message: done.error || 'complete failed' });
      return { ok: false, error: done.error || 'complete failed' };
    }
    onProgress?.({ phase: 'complete', bytesUploaded: file.size, bytesTotal: file.size });
    return { ok: true, url: done.url };
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
      await fetch('/api/r2/multipart/abort', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket, key, uploadId }),
      }).catch(() => null);
      onProgress?.({ phase: 'aborted', message: 'Upload cancelled' });
      return { ok: false, error: 'aborted' };
    }
    await fetch('/api/r2/multipart/abort', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, key, uploadId }),
    }).catch(() => null);
    const msg = e instanceof Error ? e.message : String(e);
    onProgress?.({ phase: 'failed', message: msg });
    return { ok: false, error: msg };
  }
}

export { MULTIPART_THRESHOLD };
