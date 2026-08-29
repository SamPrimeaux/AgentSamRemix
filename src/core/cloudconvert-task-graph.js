/**
 * CloudConvert workflow presets — video encode, thumbnails, capture, ffmpeg command chains.
 * @see https://cloudconvert.com/api/v2/convert
 */

import { resolveWorkerR2BucketName } from './r2-storage-scope.js';

/** @typedef {'import/url' | 'import/s3'} ImportMode */

/** @param {any} env @param {{ bucket?: string }|null|undefined} [asset] */
function requireR2BucketName(env, asset) {
  const fromAsset = String(asset?.bucket || '').trim();
  if (fromAsset) return fromAsset;
  const fromBinding = resolveWorkerR2BucketName(env, 'ASSETS');
  if (fromBinding) return fromBinding;
  throw new Error('r2_bucket_required');
}

/**
 * @param {any} env
 */
export function getR2S3Credentials(env) {
  const accessKeyId = String(env?.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env?.R2_SECRET_ACCESS_KEY || '').trim();
  const accountId = String(env?.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!accessKeyId || !secretAccessKey || !accountId) return null;
  return {
    access_key_id: accessKeyId,
    secret_access_key: secretAccessKey,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
  };
}

/**
 * @param {any} env
 * @param {any} asset
 * @param {string} [importUrl]
 */
export function buildImportTask(env, asset, importUrl) {
  const r2 = getR2S3Credentials(env);
  const bucket = String(asset?.bucket || '').trim();
  const key = String(asset?.object_key || '').trim();
  if (r2 && key && !bucket) throw new Error('r2_bucket_required');
  if (r2 && bucket && key) {
    return {
      operation: 'import/s3',
      bucket,
      key,
      ...r2,
    };
  }
  if (!importUrl) throw new Error('import url or R2 credentials required');
  return {
    operation: 'import/url',
    url: importUrl,
    ...(asset?.filename ? { filename: String(asset.filename) } : {}),
  };
}

/**
 * @param {any} env
 * @param {string} inputTask
 * @param {string} objectKey
 */
export function buildExportS3Task(env, inputTask, objectKey, bucketName) {
  const r2 = getR2S3Credentials(env);
  if (!r2) throw new Error('R2 credentials required for export/s3');
  const bucket = String(bucketName || '').trim();
  if (!bucket) throw new Error('r2_bucket_required');
  return {
    operation: 'export/s3',
    input: inputTask,
    bucket,
    key: objectKey,
    ...r2,
  };
}

export const CLOUDCONVERT_PRESETS = {
  'video-h264': {
    title: 'H.264 MP4 (web)',
    description: 'H.264/AAC MP4 — broad compatibility.',
    outputs: ['video'],
    convert: { output_format: 'mp4', video_codec: 'x264', audio_codec: 'aac' },
  },
  'video-h264-gpu': {
    title: 'H.264 MP4 (GPU NVENC)',
    description: 'GPU-accelerated H.264 when available.',
    outputs: ['video'],
    convert: { output_format: 'mp4', video_codec: 'x264', audio_codec: 'aac', engine: 'ffmpeg' },
    gpu: true,
  },
  'video-hevc': {
    title: 'HEVC/H.265 MP4',
    description: 'Smaller files, modern players.',
    outputs: ['video'],
    convert: { output_format: 'mp4', video_codec: 'x265', audio_codec: 'aac' },
  },
  'video-av1': {
    title: 'AV1 MP4',
    description: 'Next-gen codec — best compression, slower encode.',
    outputs: ['video'],
    convert: { output_format: 'mp4', video_codec: 'av1', audio_codec: 'aac' },
  },
  'proxy-720p': {
    title: '720p proxy MP4',
    description: 'Editor-friendly proxy clip.',
    outputs: ['video'],
    convert: {
      output_format: 'mp4',
      video_codec: 'x264',
      width: 1280,
      height: 720,
      fit: 'scale',
      audio_codec: 'aac',
    },
  },
  'mov-to-mp4': {
    title: 'MOV → MP4',
    description: 'Remux/transcode QuickTime to MP4.',
    outputs: ['video'],
    convert: { input_format: 'mov', output_format: 'mp4', video_codec: 'x264', audio_codec: 'aac' },
  },
  'encode-plus-thumb': {
    title: 'Encode + poster thumbnail',
    description: 'MP4 output plus PNG poster frame.',
    outputs: ['video', 'thumbnail'],
    convert: { output_format: 'mp4', video_codec: 'x264', audio_codec: 'aac' },
    thumbnail: { output_format: 'png', width: 640, fit: 'max', count: 1 },
  },
  'thumbnail-only': {
    title: 'Thumbnail / poster',
    description: 'PNG poster from video or PDF page.',
    outputs: ['thumbnail'],
    thumbnail: { output_format: 'png', width: 640, fit: 'max', count: 1 },
  },
  'capture-website-pdf': {
    title: 'Capture website → PDF',
    description: 'Headless print-to-PDF.',
    outputs: ['capture'],
    capture: { output_format: 'pdf', wait_until: 'networkidle0' },
  },
  'capture-website-png': {
    title: 'Capture website → PNG',
    description: 'Full-page screenshot.',
    outputs: ['capture'],
    capture: { output_format: 'png', wait_until: 'load' },
  },
  'ffmpeg-custom': {
    title: 'Custom ffmpeg command',
    description: 'Run ffmpeg on imported asset (pass ffmpeg_arguments).',
    outputs: ['video'],
  },
};

/**
 * @param {string} presetKey
 * @param {{
 *   env: any,
 *   asset?: any,
 *   importUrl?: string,
 *   workspaceId: string,
 *   jobId: string,
 *   projectId?: string | null,
 *   convertOptions?: Record<string, unknown>,
 *   captureUrl?: string,
 *   ffmpegArguments?: string,
 *   exportMode?: 'url' | 's3',
 * }} ctx
 */
export function buildCloudConvertTaskGraph(presetKey, ctx) {
  const preset = CLOUDCONVERT_PRESETS[presetKey];
  if (!preset) throw new Error(`unknown cloudconvert preset: ${presetKey}`);

  const tasks = {};
  const slug = ctx.projectId || 'conversions';
  const baseKey = `moviemode/${ctx.workspaceId}/${slug}/converted/${ctx.jobId}`;

  if (preset.capture) {
    const url = String(ctx.captureUrl || '').trim();
    if (!url) throw new Error('capture_url required for capture presets');
    tasks['capture-asset'] = {
      operation: 'capture-website',
      url,
      ...preset.capture,
      ...(ctx.convertOptions?.capture || {}),
    };
    const exportInput = 'capture-asset';
    if (ctx.exportMode === 's3' && getR2S3Credentials(ctx.env)) {
      const ext = preset.capture.output_format || 'pdf';
      tasks['export-asset'] = buildExportS3Task(
        ctx.env,
        exportInput,
        `${baseKey}.${ext}`,
        requireR2BucketName(ctx.env, ctx.asset),
      );
    } else {
      tasks['export-asset'] = { operation: 'export/url', input: exportInput };
    }
    return {
      tasks,
      preset: presetKey,
      outputs: preset.outputs,
      r2_outputs: ctx.exportMode === 's3' ? { capture: `${baseKey}.${preset.capture.output_format || 'pdf'}` } : null,
    };
  }

  if (!ctx.asset) throw new Error('asset required');
  tasks['import-asset'] = buildImportTask(ctx.env, ctx.asset, ctx.importUrl);

  if (ctx.ffmpegArguments || presetKey === 'ffmpeg-custom') {
    const args =
      String(ctx.ffmpegArguments || '').trim() ||
      '-i /input/import-asset/input -vcodec libx264 -acodec copy /output/output.mp4';
    tasks['ffmpeg-cmd'] = {
      operation: 'command',
      engine: 'ffmpeg',
      input: 'import-asset',
      command: 'ffmpeg',
      arguments: args,
    };
    if (ctx.exportMode === 's3' && getR2S3Credentials(ctx.env)) {
      tasks['export-asset'] = buildExportS3Task(
        ctx.env,
        'ffmpeg-cmd',
        `${baseKey}.mp4`,
        requireR2BucketName(ctx.env, ctx.asset),
      );
    } else {
      tasks['export-asset'] = { operation: 'export/url', input: 'ffmpeg-cmd' };
    }
    return {
      tasks,
      preset: presetKey,
      outputs: ['video'],
      r2_outputs: ctx.exportMode === 's3' ? { video: `${baseKey}.mp4` } : null,
    };
  }

  const convertOpts = {
    operation: 'convert',
    input: 'import-asset',
    ...preset.convert,
    ...(ctx.convertOptions?.convert || {}),
  };
  if (preset.gpu) {
    convertOpts.engine = convertOpts.engine || 'ffmpeg';
  }
  tasks['convert-asset'] = convertOpts;

  if (preset.thumbnail) {
    tasks['thumb-asset'] = {
      operation: 'thumbnail',
      input: 'import-asset',
      ...preset.thumbnail,
      ...(ctx.convertOptions?.thumbnail || {}),
    };
    if (ctx.exportMode === 's3' && getR2S3Credentials(ctx.env)) {
      tasks['export-thumb'] = buildExportS3Task(
        ctx.env,
        'thumb-asset',
        `${baseKey}-poster.png`,
        requireR2BucketName(ctx.env, ctx.asset),
      );
    } else {
      tasks['export-thumb'] = { operation: 'export/url', input: 'thumb-asset' };
    }
  }

  if (ctx.exportMode === 's3' && getR2S3Credentials(ctx.env)) {
    const ext = convertOpts.output_format || 'mp4';
    tasks['export-asset'] = buildExportS3Task(
      ctx.env,
      'convert-asset',
      `${baseKey}.${ext}`,
      requireR2BucketName(ctx.env, ctx.asset),
    );
  } else {
    tasks['export-asset'] = { operation: 'export/url', input: 'convert-asset' };
  }

  const r2_outputs =
    ctx.exportMode === 's3'
      ? {
          video: `${baseKey}.${convertOpts.output_format || 'mp4'}`,
          ...(preset.thumbnail ? { thumbnail: `${baseKey}-poster.png` } : {}),
        }
      : null;

  return { tasks, preset: presetKey, outputs: preset.outputs, r2_outputs };
}

export function listCloudConvertPresets() {
  return Object.entries(CLOUDCONVERT_PRESETS).map(([id, p]) => ({
    id,
    title: p.title,
    description: p.description,
    outputs: p.outputs,
  }));
}
