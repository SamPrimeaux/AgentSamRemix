/**
 * Shared file classification for R2 API + dashboard (keep in sync with app/src/lib/fileKind.ts).
 */

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const TEXT_EXT = new Set([
  'txt', 'md', 'json', 'jsonl', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'htm', 'xml',
  'yml', 'yaml', 'sql', 'py', 'sh', 'env', 'toml', 'ini', 'csv', 'tsv', 'liquid',
  'mjs', 'cjs', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'vue', 'svelte', 'graphql', 'gql',
  'wrangler',
]);

const LARGE_BINARY_BYTES = 512 * 1024;
const MAX_PREVIEW_BYTES = 500_000;

const BINARY_ONLY_EXT = new Set([
  'sqlite', 'db', 'sqlite-shm', 'sqlite-wal',
  'wasm', 'bin', 'exe', 'dmg', 'pkg',
  'zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar',
  'woff', 'woff2', 'eot', 'ttf', 'otf',
]);

const BINARY_EXTENSIONS = new Set([
  '.sqlite', '.db', '.sqlite-shm', '.sqlite-wal',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico', '.bmp', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.wasm', '.bin', '.exe',
  '.mp4', '.mp3', '.mov', '.wav', '.ogg', '.webm',
  '.ttf', '.woff', '.woff2', '.eot',
]);

export function isBinaryFile(filename, fileSize) {
  const dot = String(filename || '').lastIndexOf('.');
  if (dot >= 0) {
    const ext = String(filename).slice(dot).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return true;
  }
  if (fileSize != null && fileSize > MAX_PREVIEW_BYTES) return true;
  return false;
}

function extFromName(name, key) {
  const raw = String(name || key || '').split(/[?#]/)[0];
  // Dotfiles with no further extension (.gitignore, .env, .cursorrules, etc.) are text
  const basename = raw.split('/').pop() || raw;
  if (basename.startsWith('.') && basename.indexOf('.', 1) < 0) return 'txt';
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return '';
  return raw.slice(dot + 1).toLowerCase();
}

function ctBase(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

/** @returns {'text'|'image'|'video'|'audio'|'pdf'|'binary'|'unknown'} */
export function detectFileKind({ key, name, contentType, size }) {
  const ext = extFromName(name, key);
  const ct = ctBase(contentType);

  if (BINARY_ONLY_EXT.has(ext)) return 'binary';
  if (isBinaryFile(name || key || '', size ?? null)) return 'binary';

  if (ct.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image';
  if (ct.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video';
  if (ct.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio';
  if (ct === 'application/pdf' || ext === 'pdf') return 'pdf';

  if (
    ct.startsWith('text/') ||
    ct === 'application/json' ||
    ct === 'application/xml' ||
    ct === 'application/javascript' ||
    ct === 'application/typescript' ||
    ct === 'application/x-yaml' ||
    ct === 'application/yaml' ||
    (ct === 'application/sql' && TEXT_EXT.has(ext)) ||
    TEXT_EXT.has(ext)
  ) {
    return 'text';
  }

  if (ct === 'application/octet-stream') return 'binary';

  if (!ct && (IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext))) {
    if (IMAGE_EXT.has(ext)) return 'image';
    if (VIDEO_EXT.has(ext)) return 'video';
    return 'audio';
  }

  if (size != null && size > LARGE_BINARY_BYTES && !TEXT_EXT.has(ext)) return 'binary';

  if (ext && !TEXT_EXT.has(ext) && ct && !ct.startsWith('text/')) return 'binary';

  return 'unknown';
}

export function isEditableTextKind(kind) {
  return kind === 'text';
}
