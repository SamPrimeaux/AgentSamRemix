/**
 * Pure helpers for OpenAI apply_patch_call SSE item merge / finalize.
 * Kept free of fs/PTY imports so unit tests can load without Workers graph.
 */

/**
 * Merge apply_patch operation objects without wiping a filled path/diff with empties.
 * @param {Record<string, unknown>|null|undefined} prev
 * @param {Record<string, unknown>|null|undefined} next
 */
export function mergeApplyPatchOperation(prev, next) {
  const a = prev && typeof prev === 'object' ? prev : {};
  const b = next && typeof next === 'object' ? next : {};
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      if (v.trim() === '') continue;
      if (k === 'diff' && typeof out.diff === 'string' && out.diff && v !== out.diff) {
        out.diff = v.length >= String(out.diff).length ? v : out.diff;
      } else {
        out[k] = v;
      }
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Upsert one apply_patch_call into a list, keyed by call_id and/or item id (apc_*).
 * @param {Array<Record<string, unknown>>} list
 * @param {Map<string, number>} byKey
 * @param {Record<string, unknown>} patch
 */
export function upsertApplyPatchCall(list, byKey, patch) {
  const callId = patch?.call_id != null ? String(patch.call_id).trim() : '';
  const itemId = patch?.id != null ? String(patch.id).trim() : '';
  let idx = null;
  if (callId && byKey.has(callId)) idx = byKey.get(callId);
  else if (itemId && byKey.has(itemId)) idx = byKey.get(itemId);

  if (idx == null) {
    idx = list.length;
    list.push({
      type: 'apply_patch_call',
      id: itemId || null,
      call_id: callId || null,
      operation: {},
      status: null,
      caller: null,
      outputIndex: null,
    });
  }

  const cur = list[idx];
  if (callId) {
    cur.call_id = callId;
    byKey.set(callId, idx);
  }
  if (itemId) {
    cur.id = itemId;
    byKey.set(itemId, idx);
  }
  if (patch.status != null && String(patch.status).trim()) cur.status = String(patch.status);
  if (patch.caller != null) cur.caller = patch.caller;
  if (patch.outputIndex != null && cur.outputIndex == null) {
    cur.outputIndex = Number(patch.outputIndex);
  }
  cur.operation = mergeApplyPatchOperation(cur.operation, patch.operation);
  return cur;
}

/**
 * Keep only executable apply_patch calls (must have path).
 * @param {Array<Record<string, unknown>>} calls
 */
export function finalizePendingApplyPatchCalls(calls) {
  const out = [];
  const seen = new Set();
  for (const c of calls || []) {
    const op = c?.operation && typeof c.operation === 'object' ? c.operation : {};
    const path = op.path != null ? String(op.path).trim() : '';
    if (!path) continue;
    const callId = String(c.call_id || c.id || '').trim();
    if (!callId || seen.has(callId)) continue;
    seen.add(callId);
    out.push({
      type: 'apply_patch_call',
      id: c.id || callId,
      call_id: callId,
      operation: op,
      status: c.status ?? null,
      provider: 'openai_responses',
      index: out.length,
      ...(c.caller != null ? { caller: c.caller } : {}),
    });
  }
  return out;
}

/**
 * Soft preference when apply_patch is on the tools menu (tool_choice remains auto).
 * Prefer structured diffs over full-file rewrites for cost/reliability; keep fs_* fallback.
 */
export const APPLY_PATCH_HYBRID_INSTRUCTION = [
  'File edits (hybrid — prefer apply_patch when available):',
  '- Prefer the built-in apply_patch tool for create/update/delete of workspace files (structured diffs: fewer tokens, tighter edits than rewriting whole files).',
  '- Keep fs_edit_file / fs_write_file as fallback when apply_patch fails, is unavailable, or a full rewrite is clearly simpler.',
  '- Do not invent absolute host paths; use repo-relative paths only. Never treat apply_patch as mandatory — choose the tool that fits the edit.',
  '- Do not use shell for file edits when fs_edit_file / agentsam_github_patch can do it — shell bypasses exact-match and diff guarantees.',
].join('\n');

/**
 * OpenAI publishes bare `gpt-5.6` as an alias → `gpt-5.6-sol` (not a fourth SKU).
 * Catalog has no bare row; resolve for capability lookup only.
 * @param {string|null|undefined} modelKey
 */
export function resolveApplyPatchCatalogModelKey(modelKey) {
  const mk = modelKey != null ? String(modelKey).trim() : '';
  if (!mk) return '';
  if (mk === 'gpt-5.6') return 'gpt-5.6-sol';
  return mk;
}

/**
 * @param {unknown[]|undefined} oaiTools
 * @param {boolean} enabled
 */
export function withApplyPatchTool(oaiTools, enabled) {
  if (!enabled) return oaiTools;
  const list = Array.isArray(oaiTools) ? [...oaiTools] : [];
  if (!list.some((t) => t && typeof t === 'object' && t.type === 'apply_patch')) {
    list.push({ type: 'apply_patch' });
  }
  return list.length ? list : undefined;
}

/**
 * Append soft apply_patch preference once (does not force tool_choice).
 * @param {string|null|undefined} systemPrompt
 * @param {boolean} enabled
 */
export function withApplyPatchHybridInstructions(systemPrompt, enabled) {
  if (!enabled) return systemPrompt;
  const base = systemPrompt != null ? String(systemPrompt) : '';
  if (base.includes('File edits (hybrid — prefer apply_patch')) return base || systemPrompt;
  if (!base.trim()) return APPLY_PATCH_HYBRID_INSTRUCTION;
  return `${base.trim()}\n\n${APPLY_PATCH_HYBRID_INSTRUCTION}`;
}
