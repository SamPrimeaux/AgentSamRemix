/**
 * Ticket close = proof, not vibes.
 *
 * Validates close prerequisites against D1 (no markdown doc_path required):
 *   1. linked_commit = full 40-char SHA
 *   2. at least one real proof gate for normal work
 *   3. consecutive_pass_count >= required_pass_count (default 1)
 *   4. high-risk only (required_pass_count >= 3): independent proof on linked_commit + RISK note
 *
 * Does NOT set status=shipped — that stays on assert:ticket-shippable.
 * in_review = claimed done / pending verification; shipped = verified closed.
 *
 * Registered from backend/workflows/handlers/named-steps.js.
 */

export const TICKET_CLOSE_PROOF_GATE_HANDLER_KEY = 'agentsam.gate.ticket_close_proof';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const PROOF_KEYS = new Set(['targeted_proof', 'e2e_tier_1', 'e2e_tier_2', 'live_product_smoke', 'human_smoke', 'independent_qc', 'e2e_tier_3']);
const INDEPENDENT_KEYS = new Set(['independent_qc', 'e2e_tier_3']);

/**
 * @param {string|null|undefined} detail
 * @param {string} prefix
 */
export function detailHasPrefix(detail, prefix) {
  const d = String(detail || '').trim();
  if (!d) return false;
  if (d.toUpperCase().startsWith(prefix.toUpperCase())) return true;
  try {
    const j = JSON.parse(d);
    if (j && typeof j === 'object') {
      const kind = String(j.kind || j.type || '').toLowerCase();
      if (kind === prefix.toLowerCase().replace(/:$/, '')) return true;
    }
  } catch {
    /* plain text */
  }
  return false;
}

/**
 * Pure checklist from already-fetched rows (shared shape with assert script).
 * @param {{
 *   ticket: Record<string, unknown>,
 *   gates: Array<Record<string, unknown>>,
 *   notes: Array<Record<string, unknown>>,
 * }} p
 */
export function evaluateTicketCloseProof(p) {
  const ticket = p.ticket || {};
  const gates = Array.isArray(p.gates) ? p.gates : [];
  const notes = Array.isArray(p.notes) ? p.notes : [];

  /** @type {string[]} */
  const missing = [];
  const linked = String(ticket.linked_commit || '').trim().toLowerCase();
  if (!FULL_SHA.test(linked)) {
    missing.push('linked_commit_40hex');
  }

  const needRaw = Number(ticket.required_pass_count);
  const need = Number.isFinite(needRaw) && needRaw > 0 ? Math.max(1, needRaw) : 1;
  const highRisk = need >= 3;
  const have = Number(ticket.consecutive_pass_count ?? 0);
  if (have < need) {
    missing.push(`consecutive_pass_count_${have}_lt_${need}`);
  }

  const proofGates = gates.filter((g) =>
    g && Number(g.ok) === 1 && PROOF_KEYS.has(String(g.gate_key || '')),
  );
  const matchingIndependentGates = proofGates.filter((g) =>
    INDEPENDENT_KEYS.has(String(g.gate_key || '')) &&
    String(g.git_sha || '').trim().toLowerCase() === linked,
  );
  if (proofGates.length < 1) missing.push('proof_gate');
  if (highRisk && FULL_SHA.test(linked) && matchingIndependentGates.length < 1) {
    missing.push('independent_qc_git_sha_match');
  }

  const riskFromReason = detailHasPrefix(ticket.status_reason, 'RISK:');
  const riskNotes = notes.filter((n) => detailHasPrefix(n.detail, 'RISK:'));
  if (highRisk && !riskFromReason && riskNotes.length < 1) missing.push('risk_notes');

  return {
    ok: missing.length === 0,
    missing,
    required_pass_count: need,
    consecutive_pass_count: have,
    linked_commit: linked || null,
    high_risk: highRisk,
    matching_proof_gates: proofGates.map((g) => ({
      id: g.id, gate_key: g.gate_key, git_sha: g.git_sha, match: 'ticket-proof',
    })),
    matching_independent_gates: matchingIndependentGates.map((g) => ({
      id: g.id,
      gate_key: g.gate_key,
      git_sha: g.git_sha,
      match: 'exact',
    })),
    risk_note_ids: riskNotes.map((n) => n.id),
    risk_on_status_reason: riskFromReason,
    law: 'risk-weighted close proof — linked commit + direct proof; independent QC/RISK note only for high-risk tickets',
  };
}

/**
 * @param {unknown} env
 * @param {string} ticketId
 */
export async function loadTicketCloseProofEvidence(env, ticketId) {
  const tid = String(ticketId || '').trim();
  if (!tid) throw new Error('ticket_id required');
  if (!env?.DB) throw new Error('Database not configured');

  const ticket = await env.DB.prepare(
    `SELECT id, status, status_reason, linked_commit, consecutive_pass_count,
            required_pass_count, last_gate_run_id, last_gate_ok_at, surface, closed_at
     FROM agentsam_tickets WHERE id = ? LIMIT 1`,
  )
    .bind(tid)
    .first();

  if (!ticket) return { ticket: null, gates: [], notes: [] };

  const { results: gates } = await env.DB.prepare(
    `SELECT id, ok, git_sha, gate_key, created_at FROM agentsam_gate_runs
     WHERE ticket_id = ? AND ok = 1
     ORDER BY created_at DESC LIMIT 40`,
  )
    .bind(tid)
    .all();

  const { results: notes } = await env.DB.prepare(
    `SELECT id, detail, created_at FROM agentsam_ticket_events
     WHERE ticket_id = ? AND event_type = 'note'
     ORDER BY created_at DESC LIMIT 40`,
  )
    .bind(tid)
    .all();

  return { ticket, gates: gates || [], notes: notes || [] };
}

/**
 * Workflow agent_step entry.
 * Input: { ticket_id } (also accepts id).
 */
export async function ticketCloseProofGateStep(env, { input, smoke } = {}) {
  if (smoke) {
    return {
      ok: true,
      output: { smoke: true, skipped: true, handler_key: TICKET_CLOSE_PROOF_GATE_HANDLER_KEY },
    };
  }

  const flat =
    input && typeof input === 'object' && !Array.isArray(input)
      ? { ...input, ...(input.output && typeof input.output === 'object' ? input.output : {}) }
      : {};
  const ticketId = String(flat.ticket_id || flat.id || flat.ticketId || '').trim();
  if (!ticketId) {
    return { ok: false, error: 'ticket_id required', output: { missing: ['ticket_id'] } };
  }

  const evidence = await loadTicketCloseProofEvidence(env, ticketId);
  if (!evidence.ticket) {
    return { ok: false, error: 'ticket_not_found', output: { ticket_id: ticketId } };
  }
  if (String(evidence.ticket.surface || 'platform') !== 'platform') {
    return {
      ok: false,
      error: 'close_proof_platform_only',
      output: { ticket_id: ticketId, surface: evidence.ticket.surface },
    };
  }

  const verdict = evaluateTicketCloseProof(evidence);
  if (!verdict.ok) {
    return {
      ok: false,
      error: `close_proof_incomplete:${verdict.missing.join(',')}`,
      output: { ticket_id: ticketId, ...verdict },
    };
  }

  return {
    ok: true,
    output: {
      ticket_id: ticketId,
      ready_to_ship: true,
      next: `npm run assert:ticket-shippable -- --ticket=${ticketId} --set-shipped`,
      ...verdict,
      handler_key: TICKET_CLOSE_PROOF_GATE_HANDLER_KEY,
    },
  };
}
