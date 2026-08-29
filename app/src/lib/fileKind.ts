export type FileKind =
  | 'text'
  | 'truncated'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'binary'
  | 'unknown'
  /** Agent Sam plan-intake Questions surface — renders QuestionsIntakePage, not Monaco/FilePreview. */
  | 'questions_intake';

/** Max characters passed to Monaco; larger text files are sliced with fileKind `truncated`. */
export const MAX_MONACO_CHARS = 500_000;

const IMAGE_EXT = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico',
]);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const TEXT_EXT = new Set([
  'txt', 'text', 'md', 'markdown', 'json', 'jsonc', 'json5', 'jsonl', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'htm', 'xml',
  'yml', 'yaml', 'sql', 'py', 'python', 'sh', 'bash', 'zsh', 'env', 'toml', 'ini', 'cfg', 'conf', 'csv', 'tsv', 'liquid',
  'mjs', 'cjs', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'vue', 'svelte', 'graphql', 'gql',
  'gitignore', 'dockerignore', 'editorconfig', 'npmrc', 'prettierrc', 'eslintrc',
]);

const LARGE_BINARY_BYTES = 512 * 1024;
export const MAX_PREVIEW_BYTES = 500_000;

/** Extensions that must never open in Monaco (even when MIME suggests text). */
const BINARY_ONLY_EXT = new Set([
  'sqlite', 'db', 'sqlite-shm', 'sqlite-wal',
  'wasm', 'bin', 'exe', 'dmg', 'pkg',
  'zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar',
  'woff', 'woff2', 'eot', 'ttf', 'otf',
]);

export const BINARY_EXTENSIONS = new Set([
  '.sqlite', '.db', '.sqlite-shm', '.sqlite-wal',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico', '.bmp', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.wasm', '.bin', '.exe',
  '.mp4', '.mp3', '.mov', '.wav', '.ogg', '.webm',
  '.ttf', '.woff', '.woff2', '.eot',
]);

export function isBinaryFile(filename: string, fileSize?: number | null): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot >= 0) {
    const ext = filename.slice(dot).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return true;
  }
  const ext = extFromName(filename);
  if (fileSize != null && fileSize > MAX_PREVIEW_BYTES && !TEXT_EXT.has(ext)) return true;
  return false;
}

function extFromName(name?: string, key?: string): string {
  const raw = (name || key || '').split(/[?#]/)[0];
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return '';
  return raw.slice(dot + 1).toLowerCase();
}

function ctBase(contentType?: string | null): string {
  return (contentType || '').split(';')[0].trim().toLowerCase();
}

export function detectFileKind(input: {
  key?: string;
  name?: string;
  contentType?: string | null;
  size?: number | null;
}): FileKind {
  const ext = extFromName(input.name, input.key);
  const ct = ctBase(input.contentType);
  const size = input.size ?? null;

  if (BINARY_ONLY_EXT.has(ext)) return 'binary';

  // Previewable media — classify before isBinaryFile (MP4/MOV are binary for Monaco but video for FilePreview / MovieMode).
  if (ct.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image';
  if (ct.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video';
  if (ct.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio';
  if (ct === 'application/pdf' || ext === 'pdf') return 'pdf';

  if (isBinaryFile(input.name || input.key || '', size)) return 'binary';

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
    return IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : 'audio';
  }

  if (size != null && size > LARGE_BINARY_BYTES && !TEXT_EXT.has(ext)) {
    return 'binary';
  }

  if (ext && !TEXT_EXT.has(ext) && ct && !ct.startsWith('text/')) {
    return 'binary';
  }

  return 'unknown';
}

export function truncateContentForMonaco(content: string): {
  content: string;
  truncated: boolean;
  originalSize?: number;
} {
  if (!content || content.length <= MAX_MONACO_CHARS) {
    return { content: content ?? '', truncated: false };
  }
  return {
    content: content.slice(0, MAX_MONACO_CHARS),
    truncated: true,
    originalSize: content.length,
  };
}

export function isEditableTextKind(kind: FileKind): boolean {
  return kind === 'text' || kind === 'truncated';
}

export function fileKindToMediaKind(kind: FileKind): string {
  if (
    kind === 'image' ||
    kind === 'video' ||
    kind === 'audio' ||
    kind === 'text' ||
    kind === 'truncated' ||
    kind === 'binary'
  ) {
    return kind === 'truncated' ? 'text' : kind;
  }
  if (kind === 'pdf') return 'binary';
  return 'unknown';
}
