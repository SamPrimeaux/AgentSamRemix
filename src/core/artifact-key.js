/**
 * Canonical agentsam_artifacts R2 key builder + type contracts.
 *
 * Default bucket (Worker binding ARTIFACTS → R2 bucket `artifacts`):
 *   user/{au_*}/{kind}/{artifact_id}.{ext}
 *
 * Isolation law (LOCKED):
 * - Each auth user only CRUD-owns keys under their `user/{au_*}/` prefix.
 * - No cross-user mixing unless the artifact is explicitly shared
 *   (project collaborator / project owner) or marked public for content read.
 * - workspace_id lives in D1 only — never in the R2 path.
 *
 * Legacy prefix chaos (pre-policy rows) — map via inferLegacyArtifactBucket():
 *   workspaces/…          → inneranimalmedia-autorag
 *   agentsam/plans/…      → inneranimalmedia-autorag
 *   cms/test-runs/…       → inneranimalmedia
 *   draw/…                → inneranimalmedia
 *   artifacts/user/ws_*…  → artifacts (legacy wrong path; still readable via D1 user_id)
 *   artifacts/rebuilt/…   → (tombstone — no object)
 */

/** Content format stored in agentsam_artifacts.artifact_type */
export const ARTIFACT_FORMATS = Object.freeze([
  'html',
  'css',
  'js',
  'json',
  'markdown',
  'excalidraw',
  'sql',
  'txt',
  'image',
  'svg',
  'video',
  'report',
  'other',
]);

/** Semantic roles — persist in metadata_json.kind or derive from source / tool */
export const ARTIFACT_KINDS = Object.freeze([
  'capture',
  'export',
  'generated',
  'canvas',
  'plan',
  'report',
  'test_run',
  'tmp',
]);

/** agentsam_artifacts.scope */
export const ARTIFACT_SCOPES = Object.freeze(['user', 'workspace', 'platform']);

export const ARTIFACT_EXT = Object.freeze({
  html: 'html',
  css: 'css',
  js: 'js',
  json: 'json',
  markdown: 'md',
  md: 'md',
  excalidraw: 'excalidraw',
  sql: 'sql',
  txt: 'txt',
  image: 'png',
  svg: 'svg',
  video: 'webm',
  report: 'md',
  other: 'bin',
});

const BUCKET_ARTIFACTS = 'artifacts';
const BUCKET_AUTORAG = 'inneranimalmedia-autorag';
const BUCKET_ASSETS = 'inneranimalmedia';

function safeSegment(value) {
  const s = String(value ?? '').trim();
  if (!s || s.includes('/') || s.includes('\\') || s.includes('..')) return null;
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * Normalize freeform DB artifact_type to a controlled format.
 * @param {string} raw
 */
export function normalizeArtifactFormat(raw) {
  const t = String(raw || 'other').trim().toLowerCase();
  if (ARTIFACT_FORMATS.includes(t)) return t;
  if (t === 'md') return 'markdown';
  if (t.startsWith('visualizer_')) return 'json';
  return 'other';
}

/**
 * @param {string} raw
 */
export function normalizeArtifactKind(raw) {
  const k = String(raw || 'generated').trim().toLowerCase();
  if (ARTIFACT_KINDS.includes(k)) return k;
  if (k === 'png_export' || k === 'json_scene') return 'canvas';
  return 'generated';
}

/**
 * Default R2 bucket for new artifact writes — always the dedicated artifacts bucket.
 * Legacy rows on inneranimalmedia / autorag are backfilled in migration 593 only.
 */
export function defaultArtifactBucket(_opts = {}) {
  return BUCKET_ARTIFACTS;
}

/**
 * Canonical key for new artifacts (ARTIFACTS bucket lane).
 *   user/{user_id}/{kind}/{artifact_id}.{ext}
 *
 * User owns storage — workspace_id lives in D1 only, never in the R2 path.
 *
 * @param {{
 *   userId: string,
 *   kind?: string,
 *   artifactId: string,
 *   format?: string,
 * }} p
 */
export function buildArtifactR2Key(p) {
  const uid = safeSegment(p.userId);
  const id = safeSegment(p.artifactId);
  if (!uid || !id) return null;
  const kind = normalizeArtifactKind(p.kind);
  const format = normalizeArtifactFormat(p.format || kind);
  const ext = ARTIFACT_EXT[format] || ARTIFACT_EXT.other;
  return `user/${uid}/${kind}/${id}.${ext}`;
}

/**
 * Strict user prefix for ARTIFACTS R2: `user/{au_*}/`
 * @param {string} userId
 */
export function userArtifactKeyPrefix(userId) {
  const uid = safeSegment(userId);
  return uid ? `user/${uid}/` : null;
}

/**
 * True when r2_key is owned by this user under the canonical prefix.
 * Legacy `artifacts/user/…` keys are NOT treated as owned by path — access is D1 user_id only.
 * @param {string} userId
 * @param {string} r2Key
 */
export function isOwnedArtifactR2Key(userId, r2Key) {
  const prefix = userArtifactKeyPrefix(userId);
  const key = String(r2Key || '').trim();
  if (!prefix || !key) return false;
  return key.startsWith(prefix);
}

/**
 * @deprecated Legacy autorag lane — reads only. New writes use buildArtifactR2Key (user/ prefix).
 * @param {{ userId: string, workspaceId: string, format?: string, artifactId: string }} p
 */
export function buildWorkspaceAutoragArtifactKey(p) {
  const uid = safeSegment(p.userId);
  const wid = safeSegment(p.workspaceId);
  const id = safeSegment(p.artifactId);
  if (!uid || !wid || !id) return null;
  const format = normalizeArtifactFormat(p.format || 'other');
  const ext = ARTIFACT_EXT[format] || ARTIFACT_EXT.other;
  return `workspaces/${uid}/${wid}/artifacts/${format}/${id}.${ext}`;
}

/**
 * Best-effort bucket inference for legacy rows missing r2_bucket.
 * @param {string} r2Key
 */
export function inferLegacyArtifactBucket(r2Key) {
  const key = String(r2Key || '').trim();
  if (!key || key.includes('missing-r2-key')) return BUCKET_ARTIFACTS;
  if (key.startsWith('user/')) return BUCKET_ARTIFACTS;
  if (key.startsWith('artifacts/')) return BUCKET_ARTIFACTS;
  if (key.startsWith('workspaces/') || key.startsWith('agentsam/plans/')) return BUCKET_AUTORAG;
  if (key.startsWith('agentsam/')) return BUCKET_AUTORAG;
  if (
    key.startsWith('cms/') ||
    key.startsWith('draw/') ||
    key.startsWith('designstudio/') ||
    key.startsWith('meet/') ||
    key.startsWith('analytics/')
  ) {
    return BUCKET_ASSETS;
  }
  if (key.startsWith('artifacts/') || key.startsWith('generated/')) return BUCKET_ARTIFACTS;
  return BUCKET_ARTIFACTS;
}

export const ARTIFACT_BUCKET_NAMES = Object.freeze({
  artifacts: BUCKET_ARTIFACTS,
  autorag: BUCKET_AUTORAG,
  assets: BUCKET_ASSETS,
});

/**
 * Resolve Worker R2 binding handle for agentsam_artifacts row bucket name.
 * @param {any} env
 * @param {string} [bucketName]
 */
export function resolveArtifactR2Binding(env, bucketName) {
  const name = String(bucketName || BUCKET_ARTIFACTS).trim();
  if (name === BUCKET_ARTIFACTS) return env?.ARTIFACTS || null;
  if (name === BUCKET_AUTORAG) return env?.AUTORAG_BUCKET || null;
  if (name === BUCKET_ASSETS) return env?.ASSETS || null;
  return null;
}
