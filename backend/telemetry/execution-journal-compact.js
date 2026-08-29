/**
 * Execution-journal write-path compaction (Batch 1).
 *
 * Stops uncapped D1 JSON in tool_chain / workflow_runs / execution_steps.
 * New rows only — no historical purge, no archive-all R2.
 *
 * Hard ceiling: ~50KB without digest/pointer → fail loud.
 * Preferred inline: ≤8KB; larger payloads become a compact stub (+ optional
 * agentsam_execution_artifacts pointer; R2 only when retention_class allows).
 */

export const EXEC_JOURNAL_INLINE_MAX = 8_192;
export const EXEC_JOURNAL_HARD_CEILING = 50_000;
export const EXEC_JOURNAL_SUMMARY_MIN = 20;
export const EXEC_JOURNAL_PREVIEW_MAX = 1_500;
export const EXEC_JOURNAL_SUMMARY_MAX = 1_000;

/** Retention classes allowed to optionally land payload bytes in R2. */
export const EXEC_ARTIFACT_R2_CLASSES = Object.freeze([
  'failed',
  'eval',
  'deploy',
  'pinned',
  'audit',
]);

/**
 * @param {string} value
 * @returns {Promise<string>}
 */
export async function sha256Hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * @param {unknown} value
 * @param {string} [fallback='{}']
 * @returns {string}
 */
export function safeJsonStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return fallback;
  }
}

/**
 * Build a ≥20-char output_summary for completed/failed chain rows.
 * @param {unknown} output
 * @param {{ toolName?: string|null, errorMessage?: string|null, ok?: boolean }} [opts]
 * @returns {string}
 */
export function ensureOutputSummary(output, opts = {}) {
  const toolHint = opts.toolName != null ? String(opts.toolName).trim() : '';
  const errHint = opts.errorMessage != null ? String(opts.errorMessage).trim() : '';
  let text = '';
  if (typeof output === 'string') {
    text = output;
  } else if (output && typeof output === 'object') {
    text =
      output.content?.[0]?.text ??
      output.text ??
      output.message ??
      output.error ??
      output.summary ??
      '';
    if (!text) text = safeJsonStringify(output, '');
  }
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (!text && errHint) text = errHint;
  if (!text) {
    const verb = opts.ok === false ? 'failed' : 'completed';
    text = toolHint
      ? `${toolHint} ${verb} with empty output`
      : `tool ${verb} with empty output`;
  }
  if (text.length < EXEC_JOURNAL_SUMMARY_MIN) {
    const pad = toolHint || 'execution';
    text = `${text} (${pad})`.slice(0, EXEC_JOURNAL_SUMMARY_MAX);
    if (text.length < EXEC_JOURNAL_SUMMARY_MIN) {
      text = (text + ' — journal summary').slice(0, EXEC_JOURNAL_SUMMARY_MAX);
    }
  }
  return text.slice(0, EXEC_JOURNAL_SUMMARY_MAX);
}

/**
 * Fail loud if a journal JSON cell exceeds the hard ceiling without a digest/pointer.
 * @param {string|null|undefined} jsonText
 * @param {{ digest?: string|null, artifactId?: string|null, field?: string }} [meta]
 */
export function assertJournalPayloadUnderCeiling(jsonText, meta = {}) {
  const s = jsonText == null ? '' : String(jsonText);
  if (s.length <= EXEC_JOURNAL_HARD_CEILING) return;
  const digest = meta.digest != null ? String(meta.digest).trim() : '';
  const artifactId = meta.artifactId != null ? String(meta.artifactId).trim() : '';
  if (digest || artifactId) return;
  const field = meta.field || 'json';
  throw new Error(
    `EXEC_JOURNAL_FAT_WITHOUT_POINTER: ${field} length=${s.length} exceeds ${EXEC_JOURNAL_HARD_CEILING} without digest/artifact_id`,
  );
}

/**
 * Compact an arbitrary value for a D1 journal TEXT column.
 * Always returns jsonText ≤ HARD_CEILING (or throws).
 *
 * @param {unknown} value
 * @param {{
 *   field?: string,
 *   inlineMax?: number,
 *   previewMax?: number,
 *   artifactId?: string|null,
 * }} [opts]
 * @returns {Promise<{
 *   jsonText: string,
 *   digest: string,
 *   byteLen: number,
 *   truncated: boolean,
 *   compact: boolean,
 *   summaryHint: string,
 * }>}
 */
export async function compactPayloadForJournal(value, opts = {}) {
  const field = opts.field || 'payload';
  const inlineMax = Math.min(
    Math.max(256, Number(opts.inlineMax) || EXEC_JOURNAL_INLINE_MAX),
    EXEC_JOURNAL_HARD_CEILING,
  );
  const previewMax = Math.min(
    Math.max(64, Number(opts.previewMax) || EXEC_JOURNAL_PREVIEW_MAX),
    inlineMax - 200,
  );

  let raw =
    typeof value === 'string'
      ? value
      : safeJsonStringify(value, typeof value === 'undefined' ? 'null' : '{}');
  if (raw == null) raw = '';
  raw = String(raw);
  const byteLen = raw.length;
  const digest = await sha256Hex(raw);
  const summaryHint = ensureOutputSummary(
    typeof value === 'string' ? value.slice(0, EXEC_JOURNAL_SUMMARY_MAX) : value,
  );

  if (byteLen <= inlineMax) {
    assertJournalPayloadUnderCeiling(raw, { digest, field });
    return {
      jsonText: raw,
      digest,
      byteLen,
      truncated: false,
      compact: false,
      summaryHint,
    };
  }

  const stub = {
    __journal_compact: 1,
    field,
    digest,
    bytes: byteLen,
    preview: raw.slice(0, previewMax),
    artifact_id: opts.artifactId != null ? String(opts.artifactId) : null,
  };
  const jsonText = safeJsonStringify(stub);
  assertJournalPayloadUnderCeiling(jsonText, {
    digest,
    artifactId: stub.artifact_id,
    field,
  });
  return {
    jsonText,
    digest,
    byteLen,
    truncated: true,
    compact: true,
    summaryHint,
  };
}

/**
 * Cap execution_steps input/output JSON cells.
 * @param {unknown} value
 * @param {string} field
 * @returns {Promise<string>}
 */
export async function compactExecutionStepJson(value, field = 'output_json') {
  const packed = await compactPayloadForJournal(value ?? null, {
    field,
    inlineMax: EXEC_JOURNAL_INLINE_MAX,
  });
  return packed.jsonText;
}

/**
 * Optional D1 pointer row for exceptional payloads (no R2 by default).
 * Never writes to product agentsam_artifacts.
 *
 * @param {any} env
 * @param {{
 *   retentionClass: string,
 *   digest: string,
 *   byteLen: number,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   agentRunId?: string|null,
 *   toolChainId?: string|null,
 *   workflowRunId?: string|null,
 *   executionStepId?: string|null,
 *   field?: string|null,
 *   expiresAt?: number|null,
 *   r2Key?: string|null,
 *   preview?: string|null,
 * }} p
 * @returns {Promise<string|null>} artifact id or null
 */
export async function insertExecutionArtifactPointer(env, p) {
  if (!env?.DB) return null;
  const retentionClass = String(p.retentionClass || '').trim().toLowerCase();
  if (!retentionClass) {
    throw new Error('EXEC_ARTIFACT_MISSING_RETENTION_CLASS');
  }
  const digest = String(p.digest || '').trim();
  if (!digest || digest.length < 64) {
    throw new Error('EXEC_ARTIFACT_DIGEST_REQUIRED');
  }
  const now = Math.floor(Date.now() / 1000);
  const ttlByClass = {
    failed: 90 * 86400,
    eval: 180 * 86400,
    deploy: 365 * 86400,
    pinned: 365 * 86400,
    audit: 365 * 86400,
    success_routine: 7 * 86400,
  };
  const expiresAt =
    p.expiresAt != null
      ? Math.floor(Number(p.expiresAt))
      : now + (ttlByClass[retentionClass] ?? 30 * 86400);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error('EXEC_ARTIFACT_EXPIRES_AT_REQUIRED');
  }
  // Anti-archive: refuse R2 keys for classes outside the allowlist.
  const r2Key = p.r2Key != null && String(p.r2Key).trim() !== '' ? String(p.r2Key).trim() : null;
  if (r2Key && !EXEC_ARTIFACT_R2_CLASSES.includes(retentionClass)) {
    throw new Error(`EXEC_ARTIFACT_R2_CLASS_FORBIDDEN: ${retentionClass}`);
  }

  const id = `exa_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_execution_artifacts (
        id, tenant_id, workspace_id, user_id,
        agent_run_id, tool_chain_id, workflow_run_id, execution_step_id,
        field_name, digest_sha256, byte_len, r2_key,
        retention_class, expires_at, preview_text,
        created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id,
        p.tenantId ?? null,
        p.workspaceId ?? null,
        p.userId ?? null,
        p.agentRunId ?? null,
        p.toolChainId ?? null,
        p.workflowRunId ?? null,
        p.executionStepId ?? null,
        p.field ?? null,
        digest,
        Math.max(0, Math.floor(Number(p.byteLen) || 0)),
        r2Key,
        retentionClass,
        expiresAt,
        p.preview != null ? String(p.preview).slice(0, EXEC_JOURNAL_PREVIEW_MAX) : null,
        now,
      )
      .run();
    return id;
  } catch (e) {
    // Table may not exist until migration 1082 is applied — fail soft for pointer only.
    console.warn('[execution_artifacts]', e?.message ?? e);
    return null;
  }
}
