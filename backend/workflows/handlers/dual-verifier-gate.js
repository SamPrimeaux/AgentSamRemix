/**
 * Dual-verifier (N-of-M) gate — both independent verifier outputs must agree
 * with attached primary evidence before a ticket moves to in_review.
 *
 * Does NOT set status=shipped (ticket proof / assert:ticket-shippable still applies).
 * Disagreement → ok:false, ticket stays open, both notes appended to agentsam_ticket_events.
 *
 * Registered from backend/workflows/handlers/named-steps.js (avoid circular import).
 */

export const DUAL_VERIFIER_GATE_HANDLER_KEY = 'agentsam.gate.dual_verifier_agree';
const HANDLER_KEY = DUAL_VERIFIER_GATE_HANDLER_KEY;

function flatten(input) {
  if (input == null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return { ...input };
  return { value: input };
}

function asVerifier(raw, label) {
  if (!raw || typeof raw !== 'object') return null;
  const verdict = String(raw.verdict || raw.pass || raw.status || '')
    .trim()
    .toLowerCase();
  const passed =
    verdict === 'pass' ||
    verdict === 'passed' ||
    verdict === 'ok' ||
    verdict === 'success' ||
    raw.passed === true ||
    raw.ok === true;
  const failed =
    verdict === 'fail' ||
    verdict === 'failed' ||
    verdict === 'error' ||
    raw.passed === false ||
    raw.ok === false;
  const evidence =
    raw.evidence ??
    raw.primary_evidence ??
    raw.proof ??
    raw.query ??
    raw.grep ??
    raw.command_output ??
    null;
  const evidenceStr =
    evidence == null
      ? ''
      : typeof evidence === 'string'
        ? evidence.trim()
        : JSON.stringify(evidence).trim();
  return {
    label: String(raw.actor || raw.label || label || 'verifier').slice(0, 80),
    passed: passed && !failed,
    failed: failed || (!passed && verdict !== ''),
    evidence: evidenceStr,
    raw,
  };
}

/**
 * Collect verifier payloads from flat input or prior step_results.
 * @param {Record<string, unknown>} flat
 * @param {unknown[]} [stepResults]
 */
export function collectVerifiers(flat, stepResults = []) {
  const out = [];
  if (Array.isArray(flat.verifiers)) {
    for (let i = 0; i < flat.verifiers.length; i++) {
      const v = asVerifier(flat.verifiers[i], `verifier_${i + 1}`);
      if (v) out.push(v);
    }
  }
  for (const key of ['verifier_a', 'verifier_b', 'verifier_1', 'verifier_2']) {
    if (flat[key]) {
      const v = asVerifier(flat[key], key);
      if (v) out.push(v);
    }
  }
  if (out.length < 2 && Array.isArray(stepResults)) {
    for (const step of stepResults) {
      const nk = String(step?.node_key || '');
      if (!/^verifier/i.test(nk) && !/code-reviewer/i.test(nk)) continue;
      const payload = step?.output?.verifier || step?.output || step?.result;
      const v = asVerifier(
        typeof payload === 'object' ? payload : { verdict: step?.ok ? 'pass' : 'fail', evidence: payload },
        nk,
      );
      if (v) out.push(v);
    }
  }
  // de-dupe by label
  const seen = new Set();
  return out.filter((v) => {
    const k = v.label;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Pure agreement check (also used by CLI).
 * @param {{ verifiers: ReturnType<typeof asVerifier>[], minAgree?: number }} opts
 */
export function evaluateDualVerifierAgreement(opts) {
  const verifiers = (opts.verifiers || []).filter(Boolean);
  const minAgree = Math.max(2, Number(opts.minAgree) || 2);
  const needEvidence = opts.requireEvidence !== false;

  if (verifiers.length < minAgree) {
    return {
      ok: false,
      passed: false,
      reason: `need_at_least_${minAgree}_verifier_outputs`,
      agree_count: 0,
      min_agree: minAgree,
      verifiers,
    };
  }

  const withEvidence = verifiers.filter((v) => !needEvidence || v.evidence.length > 0);
  if (withEvidence.length < minAgree) {
    return {
      ok: false,
      passed: false,
      reason: 'missing_primary_evidence',
      agree_count: 0,
      min_agree: minAgree,
      verifiers,
    };
  }

  const passers = withEvidence.filter((v) => v.passed && !v.failed);
  const failers = withEvidence.filter((v) => v.failed || !v.passed);
  const agreeCount = passers.length;
  const allPass = agreeCount >= minAgree && failers.length === 0;

  if (!allPass) {
    return {
      ok: false,
      passed: false,
      reason: failers.length ? 'verifier_disagreement' : 'insufficient_pass_count',
      agree_count: agreeCount,
      min_agree: minAgree,
      verifiers: withEvidence,
    };
  }

  return {
    ok: true,
    passed: true,
    reason: 'n_of_m_agree',
    agree_count: agreeCount,
    min_agree: minAgree,
    verifiers: withEvidence,
  };
}

function eventId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Persist gate outcome to agentsam_ticket_events (+ optional status bump to in_review).
 * @param {any} env
 * @param {string} ticketId
 * @param {ReturnType<typeof evaluateDualVerifierAgreement>} decision
 * @param {Record<string, unknown>} meta
 */
export async function persistDualVerifierGate(env, ticketId, decision, meta = {}) {
  if (!env?.DB || !ticketId) {
    return { persisted: false, error: 'missing_db_or_ticket' };
  }

  const tid = String(ticketId).trim();
  const ticket = await env.DB.prepare(
    `SELECT id, status FROM agentsam_tickets WHERE id = ? LIMIT 1`,
  )
    .bind(tid)
    .first()
    .catch(() => null);

  if (!ticket?.id) {
    return { persisted: false, error: 'ticket_not_found' };
  }

  const fromStatus = ticket.status;
  const detailBase = {
    gate: HANDLER_KEY,
    reason: decision.reason,
    agree_count: decision.agree_count,
    min_agree: decision.min_agree,
    verifiers: (decision.verifiers || []).map((v) => ({
      label: v.label,
      passed: v.passed,
      evidence_preview: String(v.evidence || '').slice(0, 400),
    })),
    run_id: meta.runId || null,
    workflow_key: meta.workflowKey || null,
  };

  for (const v of decision.verifiers || []) {
    await env.DB.prepare(
      `INSERT INTO agentsam_ticket_events (
         id, ticket_id, event_type, from_status, to_status, detail, commit_sha, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, unixepoch())`,
    )
      .bind(
        eventId('tevt_vfy'),
        tid,
        decision.passed ? 'verifier_pass' : 'verifier_fail',
        fromStatus,
        fromStatus,
        JSON.stringify({
          ...detailBase,
          verifier: v.label,
          verdict: v.passed ? 'pass' : 'fail',
          evidence: String(v.evidence || '').slice(0, 1500),
        }).slice(0, 4000),
      )
      .run()
      .catch((e) => console.warn('[dual-verifier-gate] verifier event', e?.message ?? e));
  }

  const gateEventType = decision.passed ? 'dual_verifier_pass' : 'dual_verifier_fail';
  const gateEventId = eventId('tevt_dvg');
  await env.DB.prepare(
    `INSERT INTO agentsam_ticket_events (
       id, ticket_id, event_type, from_status, to_status, detail, commit_sha, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, unixepoch())`,
  )
    .bind(
      gateEventId,
      tid,
      gateEventType,
      fromStatus,
      decision.passed && fromStatus !== 'shipped' ? 'in_review' : fromStatus,
      JSON.stringify(detailBase).slice(0, 4000),
    )
    .run();

  if (decision.passed && fromStatus !== 'shipped') {
    // "resolved" in design language → in_review here; shipped still requires assert:ticket-shippable
    await env.DB.prepare(
      `UPDATE agentsam_tickets
       SET status = 'in_review',
           status_reason = ?,
           last_gate_ok_at = unixepoch(),
           updated_at = unixepoch()
       WHERE id = ?`,
    )
      .bind(
        `dual_verifier ${decision.agree_count}/${decision.min_agree} agree (${gateEventId})`.slice(0, 900),
        tid,
      )
      .run();
  }

  return { persisted: true, event_id: gateEventId, ticket_status: decision.passed ? 'in_review' : fromStatus };
}

/**
 * Workflow / agent-step entry.
 */
export async function runDualVerifierGate(env, input, runContext = {}) {
  const flat = flatten(input);
  const stepResults =
    Array.isArray(runContext.stepResults)
      ? runContext.stepResults
      : Array.isArray(flat.step_results)
        ? flat.step_results
        : [];

  const verifiers = collectVerifiers(flat, stepResults);
  const minAgree = Number(flat.min_agree || flat.minAgree || 2) || 2;
  const decision = evaluateDualVerifierAgreement({
    verifiers,
    minAgree,
    requireEvidence: flat.require_evidence !== false,
  });

  const ticketId = String(flat.ticket_id || flat.ticketId || '').trim();
  let persist = { persisted: false };
  if (ticketId && !runContext.smoke) {
    persist = await persistDualVerifierGate(env, ticketId, decision, {
      runId: runContext.runId,
      workflowKey: runContext.workflowKey,
    });
  }

  return {
    ok: decision.ok,
    output: {
      ...decision,
      ticket_id: ticketId || null,
      persist,
      handler_key: HANDLER_KEY,
      // Never auto-ship
      shipped: false,
      note: decision.passed
        ? 'Ticket set in_review only; run assert:ticket-shippable after dual E2E passes.'
        : 'Disagreement or missing evidence — ticket left open.',
    },
  };
}

/** agent-step adapter */
export async function dualVerifierGateStep(env, { input, runContext, smoke }) {
  if (smoke) {
    return { ok: true, output: { smoke: true, skipped: true, handler_key: HANDLER_KEY } };
  }
  return runDualVerifierGate(env, input, runContext || {});
}
