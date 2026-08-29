/**
 * Full-codebase indexing helpers.
 *
 * Structural lanes:
 *   JS/TS/TSX → tree-sitter WASM (STRUCTURAL_PARSER_ID = js-treesitter-v1)
 *   Python / Go → tree-sitter WASM (py-treesitter-v1 / go-treesitter-v1)
 * Remaining source-like text (html/css/sql/json/…) may be chunks_only (no fake AST).
 * Shell / config / docs plain-text (sh/yml/md/…) are ignored — no embed without a
 * secret-scan lane (top-level ignores like scripts/ come from D1 policy, not here).
 * Real parse errors degrade that file to chunks_only (parse_failed) — no lesser parser.
 * Successful parse with zero symbols → structure_empty chunks_only (not a failure).
 *
 * Repo allow/deny: agentsam_ignore_pattern via packages/shared/code-index/ignore-policy.js
 * (keyed by repo_full_name; loaded once per crawl).
 */

import { applyRepoIgnorePolicy } from '../../../packages/shared/code-index/ignore-policy.js';

export const FULL_INDEX_PIPELINE = 'sam.codebaseindex.index.run';
export const FULL_INDEX_MODE = 'full';
export const INCREMENTAL_INDEX_MODE = 'incremental';
/** Crawl scope on agentsam_code_index_job.source_type (not product family — that is pipeline). */
export const FULL_SOURCE_TYPE = 'codebase_full';
export const INCREMENTAL_SOURCE_TYPE = 'incremental_refresh';
/** Single-file ops smoke — real parse/embed/write; never activate / orphan-prune. */
export const FILE_SMOKE_SOURCE_TYPE = 'codebase_file_smoke';
export const PRODUCT_CODE_INDEX_SOURCE_TYPES = Object.freeze([
  FULL_SOURCE_TYPE,
  INCREMENTAL_SOURCE_TYPE,
]);
/** SQL IN (…) literals — never interpolate user input into this fragment. */
export const PRODUCT_SOURCE_TYPE_SQL_IN = `('${FULL_SOURCE_TYPE}','${INCREMENTAL_SOURCE_TYPE}')`;

/**
 * @param {unknown} sourceType
 */
export function isFileSmokeCodeIndexSourceType(sourceType) {
  return String(sourceType || '') === FILE_SMOKE_SOURCE_TYPE;
}

/**
 * @param {unknown} mode
 * @returns {'codebase_full'|'incremental_refresh'}
 */
export function sourceTypeForMode(mode) {
  return normalizeCodeIndexMode(mode) === INCREMENTAL_INDEX_MODE
    ? INCREMENTAL_SOURCE_TYPE
    : FULL_SOURCE_TYPE;
}

/**
 * @param {unknown} sourceType
 */
export function isProductCodeIndexSourceType(sourceType) {
  return PRODUCT_CODE_INDEX_SOURCE_TYPES.includes(String(sourceType || ''));
}

/** Bumped when emission rules change — skip-unchanged must not reuse older bloated parses. */
import {
  STRUCTURAL_PARSER_ID,
  JS_TREESITTER_PARSER_ID,
  PYTHON_TREESITTER_PARSER_ID,
  GO_TREESITTER_PARSER_ID,
  PYTHON_STRUCTURAL_PARSER_ID,
  GO_STRUCTURAL_PARSER_ID,
} from './structural-parse.js';
export {
  STRUCTURAL_PARSER_ID,
  JS_TREESITTER_PARSER_ID,
  PYTHON_TREESITTER_PARSER_ID,
  GO_TREESITTER_PARSER_ID,
  PYTHON_STRUCTURAL_PARSER_ID,
  GO_STRUCTURAL_PARSER_ID,
  structuralParserIdForFile,
  structuralParserIdForLanguage,
} from './structural-parse.js';
export const CHUNKER_ID = 'symbol-aware-lines-v1';

/**
 * Bare const/let/var: keep exported or Name-like bindings; drop local lowercase noise.
 * @param {{ exported?: boolean, node_name?: string }} match
 */
export function shouldEmitBindingSymbol(match) {
  const name = match?.node_name != null ? String(match.node_name) : '';
  if (!name) return false;
  if (match?.exported) return true;
  // PascalCase / UPPER_SNAKE / component-like
  if (/^[A-Z]/.test(name)) return true;
  return false;
}

/**
 * Whether a D1 AST node should receive an OpenAI symbol embedding.
 * @param {{ node_type?: string, is_exported?: number|boolean }} node
 */
export function shouldEmbedSymbolNode(node) {
  const t = String(node?.node_type || '');
  if (t === 'import') return false;
  const exported = Number(node?.is_exported) === 1 || node?.is_exported === true;
  if ((t === 'const' || t === 'variable') && !exported) return false;
  return true;
}
/** Explicit incremental with no activated snapshot — fail loud (I4). */
export const INCREMENTAL_REQUIRES_ACTIVATED_BASELINE = 'incremental_requires_activated_baseline';
export const GITHUB_REF_SHA_MISSING = 'github_ref_sha_missing';

/**
 * Queue-time base_sha. Full runs pin GitHub HEAD (the tree being crawled).
 * Incremental pins the activated snapshot. Never returns a short SHA.
 * @param {{ mode?: unknown, activatedBaselineSha?: unknown, headSha?: unknown }} opts
 * @returns {{ ok: true, base_sha: string, head_sha: string|null } | { ok: false, error: string, base_sha: null }}
 */
export function resolveQueueBaseSha(opts = {}) {
  const head = normalizeFullGitSha(opts.headSha);
  const activated = normalizeFullGitSha(opts.activatedBaselineSha);
  if (normalizeCodeIndexMode(opts.mode) === INCREMENTAL_INDEX_MODE) {
    if (!activated) {
      return { ok: false, error: INCREMENTAL_REQUIRES_ACTIVATED_BASELINE, base_sha: null };
    }
    return { ok: true, base_sha: activated, head_sha: head };
  }
  if (!head) {
    return { ok: false, error: GITHUB_REF_SHA_MISSING, base_sha: null };
  }
  return { ok: true, base_sha: head, head_sha: head };
}

/**
 * Normalize API/queue mode. Product modes beyond full|incremental are out of this blast.
 * @param {unknown} mode
 * @returns {'full'|'incremental'}
 */
export function normalizeCodeIndexMode(mode) {
  const m = String(mode || FULL_INDEX_MODE)
    .trim()
    .toLowerCase();
  return m === INCREMENTAL_INDEX_MODE ? INCREMENTAL_INDEX_MODE : FULL_INDEX_MODE;
}

/** Full 40-char lowercase git object id, or null (AGENTS.md §3 — no short SHAs). */
export function normalizeFullGitSha(raw) {
  const sha = raw != null ? String(raw).trim().toLowerCase() : '';
  return /^[a-f0-9]{40}$/.test(sha) ? sha : null;
}

/**
 * Full 40-char SHA from an activated job only (AGENTS.md §3). Failed/never-activated ≠ baseline.
 * Prefers real column `revision_sha` (migration 1164+) over JSON dual-write.
 * @param {unknown} symbolSummary
 * @param {unknown} [fileManifest]
 * @param {{ revision_sha?: unknown }|null} [jobRow] optional agentsam_code_index_job row fragment
 * @returns {string|null}
 */
export function extractActivatedRevisionSha(symbolSummary, fileManifest = null, jobRow = null) {
  let summary = symbolSummary;
  if (typeof summary === 'string') {
    try {
      summary = JSON.parse(summary);
    } catch {
      summary = null;
    }
  }
  let manifest = fileManifest;
  if (typeof manifest === 'string') {
    try {
      manifest = JSON.parse(manifest);
    } catch {
      manifest = null;
    }
  }
  const activated =
    summary?.activated === true ||
    summary?.activated === 1 ||
    String(summary?.stage || '') === 'active';
  if (!activated) return null;
  const candidates = [
    jobRow?.revision_sha,
    summary?.revision_sha,
    summary?.stages?.crawl?.revision_sha,
    summary?.stages?.activate?.revision_sha,
    manifest?.revision_sha,
    manifest?.head_sha,
  ];
  for (const raw of candidates) {
    const sha = normalizeFullGitSha(raw);
    if (sha) return sha;
  }
  return null;
}

/**
 * Build a delta crawl set from GitHub compare `files[]` (algorithm twin of ast_rag git delta).
 * @param {Array<{filename?: string, previous_filename?: string, status?: string, sha?: string, changes?: number}>} compareFiles
 * @returns {{
 *   discovery: 'compare',
 *   files: object[],
 *   removed_paths: string[],
 *   changed_count: number,
 *   totals: object,
 *   languages: object,
 * }}
 */
export function buildCompareDeltaFromGithubFiles(compareFiles = [], classifyOpts = {}) {
  const removed = new Set();
  /** @type {{ type: 'blob', path: string, sha: string|null, size: number }[]} */
  const treeEntries = [];
  for (const entry of Array.isArray(compareFiles) ? compareFiles : []) {
    const status = String(entry?.status || '')
      .trim()
      .toLowerCase();
    const filename = entry?.filename != null ? String(entry.filename).trim() : '';
    const previous =
      entry?.previous_filename != null ? String(entry.previous_filename).trim() : '';
    if (status === 'removed') {
      if (filename) removed.add(filename);
      continue;
    }
    if ((status === 'renamed' || status === 'copied') && previous) {
      removed.add(previous);
    }
    if (!filename) continue;
    if (status === 'added' || status === 'modified' || status === 'changed' || status === 'renamed' || status === 'copied' || !status) {
      treeEntries.push({
        type: 'blob',
        path: filename,
        sha: entry?.sha ? String(entry.sha) : null,
        size: Number(entry?.changes) || 0,
      });
    }
  }
  const classified = classifyRepoTree(treeEntries, classifyOpts);
  const processable = classified.files.filter(
    (file) =>
      file.classification === 'structural_and_chunks' || file.classification === 'chunks_only',
  );
  const removedPaths = [...removed].sort((a, b) => a.localeCompare(b));
  return {
    discovery: 'compare',
    files: processable,
    removed_paths: removedPaths,
    changed_count: processable.length + removedPaths.length,
    totals: classified.totals,
    languages: classified.languages,
  };
}

const JS_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);
/**
 * Soft secret-exposure surface when chunked as plain text with no scanner.
 * Language capability — not path allow/deny (that is D1 agentsam_ignore_pattern).
 */
const PLAIN_TEXT_NO_EMBED_EXTENSIONS = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'md',
  'mdx',
  'txt',
  'yaml',
  'yml',
  'toml',
  'xml',
  'dockerfile',
  'env',
  'ini',
  'cfg',
  'conf',
]);
const TEXT_EXTENSIONS = new Set([
  ...JS_EXTENSIONS,
  'py', 'go', 'rs', 'java', 'kt', 'kts', 'rb', 'php', 'swift', 'cs', 'c', 'h',
  'cpp', 'hpp', 'vue', 'svelte', 'astro', 'html', 'css', 'scss', 'less', 'sql',
  'json', 'jsonc', 'graphql', 'gql', 'proto',
]);

function extensionOf(filePath) {
  const name = String(filePath || '').split('/').pop() || '';
  if (/^dockerfile(?:\..+)?$/i.test(name)) return 'dockerfile';
  const at = name.lastIndexOf('.');
  return at >= 0 ? name.slice(at + 1).toLowerCase() : '';
}

/**
 * Path allow/deny is D1-only (repoPolicy from loadRepoIgnorePolicy).
 * No hardcoded UNIVERSAL / IAM / generated path lists.
 *
 * @param {string} filePath
 * @param {number} [sizeBytes]
 * @param {{ allow?: string[], deny?: string[] }|null} [repoPolicy]
 */
export function classifyRepoPath(filePath, sizeBytes = 0, repoPolicy = null) {
  const path = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!path || path.includes('..')) {
    return { path, classification: 'ignored', reason: 'unsafe_path', language: null };
  }

  const allow = Array.isArray(repoPolicy?.allow) ? repoPolicy.allow : [];
  const deny = Array.isArray(repoPolicy?.deny) ? repoPolicy.deny : [];
  if (!repoPolicy || (!allow.length && !deny.length)) {
    return { path, classification: 'ignored', reason: 'repo_policy_required', language: null };
  }

  const gate = applyRepoIgnorePolicy(repoPolicy, path);
  if (gate.ignored) {
    return { path, classification: 'ignored', reason: gate.reason, language: null };
  }

  if (Number(sizeBytes) > 500 * 1024) {
    return { path, classification: 'metadata_only', reason: 'file_too_large', language: extensionOf(path) || null };
  }
  const ext = extensionOf(path);
  if (JS_EXTENSIONS.has(ext)) {
    return {
      path,
      classification: 'structural_and_chunks',
      reason: null,
      language: ext,
      structural_quality: 'treesitter',
      parser_id: STRUCTURAL_PARSER_ID,
    };
  }
  if (ext === 'py') {
    return {
      path,
      classification: 'structural_and_chunks',
      reason: null,
      language: 'py',
      structural_quality: 'treesitter',
      parser_id: PYTHON_TREESITTER_PARSER_ID,
    };
  }
  if (ext === 'go') {
    return {
      path,
      classification: 'structural_and_chunks',
      reason: null,
      language: 'go',
      structural_quality: 'treesitter',
      parser_id: GO_TREESITTER_PARSER_ID,
    };
  }
  if (PLAIN_TEXT_NO_EMBED_EXTENSIONS.has(ext)) {
    return {
      path,
      classification: 'ignored',
      reason: 'plain_text_embed_disabled',
      language: ext || 'text',
    };
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return {
      path,
      classification: 'chunks_only',
      reason: 'structural_parser_unavailable',
      language: ext || 'text',
      structural_quality: 'unavailable',
      parser_id: null,
    };
  }
  return { path, classification: 'metadata_only', reason: 'binary_or_unknown', language: ext || null };
}

/**
 * @param {unknown[]} tree
 * @param {{ repoPolicy?: { allow?: string[], deny?: string[] }|null }} [opts]
 */
export function classifyRepoTree(tree, opts = {}) {
  const repoPolicy = opts.repoPolicy || null;
  const files = [];
  const totals = {
    authorized_blobs: 0,
    structural_and_chunks: 0,
    chunks_only: 0,
    metadata_only: 0,
    ignored: 0,
  };
  const languages = {};
  for (const entry of Array.isArray(tree) ? tree : []) {
    if (!entry || entry.type !== 'blob' || !entry.path) continue;
    totals.authorized_blobs += 1;
    const classified = classifyRepoPath(entry.path, entry.size, repoPolicy);
    const file = {
      ...classified,
      git_blob_sha: entry.sha ? String(entry.sha) : null,
      size_bytes: Number(entry.size) || 0,
    };
    totals[classified.classification] += 1;
    // Languages = processable source histogram only (not metadata/binary extension noise).
    if (
      classified.language &&
      (classified.classification === 'structural_and_chunks' ||
        classified.classification === 'chunks_only')
    ) {
      languages[classified.language] = (languages[classified.language] || 0) + 1;
    }
    files.push(file);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, totals, languages };
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}

/**
 * Structural symbol extract via tree-sitter WASM (JS/TS/TSX, Python, Go).
 * On parse failure returns [] (caller degrades file to chunks_only).
 * Prefer buildFullFilePlan — it also captures call_sites.
 */
export async function extractStructuralSymbols(content, file, context) {
  if (file?.classification !== 'structural_and_chunks') return [];
  const { parseStructuralForFile, structuralParserIdForFile } = await import(
    './structural-parse.js'
  );
  const parsed = await parseStructuralForFile(content, file, {
    ...context,
    parser_id: structuralParserIdForFile(file) || STRUCTURAL_PARSER_ID,
  });
  return parsed.symbols || [];
}

function chooseOwner(symbols, lineStart, lineEnd) {
  let winner = null;
  let bestOverlap = 0;
  for (const symbol of symbols) {
    const overlap = Math.max(0, Math.min(lineEnd, symbol.line_end) - Math.max(lineStart, symbol.line_start) + 1);
    if (overlap > bestOverlap) {
      winner = symbol;
      bestOverlap = overlap;
    }
  }
  return winner;
}

export function buildSymbolAwareChunks(content, symbols, options = {}) {
  const targetChars = Math.max(400, Number(options.target_chars) || 1600);
  const overlapLines = Math.max(0, Number(options.overlap_lines) || 3);
  const lines = String(content ?? '').split('\n');
  const chunks = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let chars = 0;
    while (end < lines.length && (chars < targetChars || end === start)) {
      chars += lines[end].length + 1;
      end += 1;
    }
    const lineStart = start + 1;
    const lineEnd = end;
    const text = lines.slice(start, end).join('\n').trim();
    if (text) {
      const owner = chooseOwner(symbols, lineStart, lineEnd);
      chunks.push({
        content: text,
        chunk_index: chunks.length,
        line_start: lineStart,
        line_end: lineEnd,
        node_id: owner?.id || null,
        node_name: owner?.node_name || null,
        node_type: owner?.node_type || null,
        chunker_id: CHUNKER_ID,
      });
    }
    if (end >= lines.length) break;
    start = Math.max(start + 1, end - overlapLines);
  }
  return chunks;
}

export async function buildFullFilePlan(content, file, context) {
  const fileHash = await sha256Hex(content);
  let symbols = [];
  let call_sites = [];
  let import_bindings = [];
  let structural_quality = file.structural_quality || 'unavailable';
  let parser_id = file.parser_id || null;
  let classification = file.classification;
  let parse_error = null;

  if (classification === 'structural_and_chunks') {
    const { parseStructuralForFile, structuralParserIdForFile } = await import(
      './structural-parse.js'
    );
    const expectedParser = structuralParserIdForFile(file) || STRUCTURAL_PARSER_ID;
    try {
      const parsed = await parseStructuralForFile(content, file, {
        ...context,
        file_hash: fileHash,
        parser_id: expectedParser,
      });
      symbols = parsed.symbols || [];
      call_sites = parsed.call_sites || [];
      import_bindings = parsed.import_bindings || [];
      if (!symbols.length) {
        // Legitimate empty modules (__init__.py, thin config) — chunks_only, not failure.
        classification = 'chunks_only';
        structural_quality = 'structure_empty';
        parser_id = expectedParser;
      } else {
        const fromSymbol = symbols.find((s) => s.structural_quality)?.structural_quality;
        structural_quality = fromSymbol || 'treesitter';
        parser_id = symbols.find((s) => s.parser_id)?.parser_id || expectedParser;
      }
    } catch (err) {
      // Real parse/runtime error: degrade to chunks_only; do not invent symbols/edges.
      parse_error = String(err?.message || err).slice(0, 300);
      symbols = [];
      call_sites = [];
      import_bindings = [];
      classification = 'chunks_only';
      structural_quality = 'parse_failed';
      parser_id = expectedParser;
    }
  }

  const chunks = buildSymbolAwareChunks(content, symbols);
  const structureEmpty = structural_quality === 'structure_empty';
  return {
    file: {
      ...file,
      file_hash: fileHash,
      classification,
      structural_quality,
      parser_id,
    },
    symbols,
    call_sites,
    import_bindings,
    chunks,
    stage_receipt: {
      path: file.path,
      classification,
      structural_quality,
      parser_id,
      chunker_id: CHUNKER_ID,
      revision_sha: context.revision_sha,
      file_hash: fileHash,
      git_blob_sha: file.git_blob_sha || null,
      symbol_count: symbols.length,
      chunk_count: chunks.length,
      // job_file upsert keys (chunk_count/symbol_count alone were dropped → always 0)
      symbols_written: symbols.length,
      chunks_written: chunks.length,
      call_site_count: call_sites.length,
      ...(parse_error ? { parse_error, status: 'parse_failed_chunks_only' } : {}),
      ...(structureEmpty && !parse_error
        ? { status: 'structure_empty_chunks_only', note: 'structural_symbols_empty' }
        : {}),
    },
  };
}
