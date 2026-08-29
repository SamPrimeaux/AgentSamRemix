/**
 * Build/sandbox routing hints + Antigravity model preference.
 * Antigravity is a model (Google Interactions) — NOT a separate sandbox lane.
 * Product sandbox = agentsam_terminal_sandbox → MY_CONTAINER (see terminal-three-lane-model.md).
 * Never use MY_CONTAINER as a silent side-effect of fs_search_files (clone+rg) — clipped 2026-08.
 */
import { GOOGLE_MODEL_ROUTES } from '../../backend/agentsam/catalog/google-model-routes.js';

export const ANTIGRAVITY_MODEL_KEY = GOOGLE_MODEL_ROUTES.antigravity;

/** True when picker/spine selected Google Antigravity (Interactions executor). */
export function isAntigravityModelKey(modelKey) {
  const mk = String(modelKey || '').trim().toLowerCase();
  if (!mk) return false;
  if (mk === String(ANTIGRAVITY_MODEL_KEY).trim().toLowerCase()) return true;
  if (mk === 'antigravity' || mk === 'antigravity-preview-05-2026') return true;
  return mk.includes('antigravity');
}

/** Task shapes that run in MY_CONTAINER via agentsam_terminal_sandbox. */
export const USE_CONTAINER_SANDBOX_WHEN = Object.freeze([
  'needs isolated Linux sandbox',
  'needs repo clone or mounted source',
  'needs package install + test run',
  'needs web research + generated file/artifact',
  'needs long-running multi-step attempt',
  'needs safe experiment before touching local repo',
]);

/** Lanes where local IDE / structured routing is strictly better. */
export const AVOID_CONTAINER_SANDBOX_WHEN = Object.freeze([
  'normal chat answer',
  'simple code snippet',
  'quick classification/routing',
  'strict JSON structured output needed',
  'direct production deploy',
  'task requires secrets inside sandbox',
]);

const GREENFIELD_PATTERNS = [];

const USE_PATTERNS = [];

const AVOID_PATTERNS = [];

/**
 * @param {string} message
 * @param {{ wantsStructuredOutput?: boolean, hasLocalEditIntent?: boolean, requiresMcp?: boolean }} [ctx]
 * @returns {{ recommend: boolean, score: number, reasons: string[], avoidReasons: string[], model_key: string }}
 */
export function evaluateContainerSandboxIntent(message, ctx = {}) {
  const m = String(message || '').trim();
  if (!m || m.length < 12) {
    return { recommend: false, score: 0, reasons: [], avoidReasons: ['message too short'], model_key: ANTIGRAVITY_MODEL_KEY };
  }

  /** @type {string[]} */
  const reasons = [];
  /** @type {string[]} */
  const avoidReasons = [];

  for (const { re, reason } of USE_PATTERNS) {
    if (re.test(m)) reasons.push(reason);
  }
  for (const { re, reason } of GREENFIELD_PATTERNS) {
    if (re.test(m)) reasons.push(reason);
  }
  for (const { re, reason } of AVOID_PATTERNS) {
    if (re.test(m)) avoidReasons.push(reason);
  }

  if (ctx.wantsStructuredOutput) avoidReasons.push('strict JSON structured output needed');
  if (ctx.requiresMcp) avoidReasons.push('task requires mcp');
  if (ctx.hasLocalEditIntent && reasons.length === 0) {
    avoidReasons.push('simple local edit — use IDE lane');
  }

  let score = Math.min(1, reasons.length * 0.22);
  if (GREENFIELD_PATTERNS.some(({ re }) => re.test(m))) {
    score = Math.max(score, 0.62);
  }
  if (avoidReasons.length) score -= avoidReasons.length * 0.28;
  score = Math.max(0, Math.min(1, score));

  const recommend = score >= 0.45 && reasons.length > 0 && avoidReasons.length === 0;

  return {
    recommend,
    score,
    reasons: [...new Set(reasons)],
    avoidReasons: [...new Set(avoidReasons)],
    model_key: ANTIGRAVITY_MODEL_KEY,
  };
}

/** @deprecated use evaluateContainerSandboxIntent */
export const evaluateAntigravityIntent = evaluateContainerSandboxIntent;

/**
 * Prefer MY_CONTAINER sandbox + optional Antigravity model for heavy build turns.
 * Product sandbox = agentsam_terminal_sandbox → MY_CONTAINER (see terminal-three-lane-model.md).
 * Never use MY_CONTAINER as a silent side-effect of fs_search_files (clone+rg) — that path is clipped.
 * @param {Record<string, unknown>} decision
 * @param {string} message
 * @returns {Record<string, unknown>}
 */
export function applyAntigravityOverlay(decision, message) {
  const d = decision && typeof decision === 'object' ? { ...decision } : {};
  const evalResult = evaluateContainerSandboxIntent(message, {
    wantsStructuredOutput: /\b(json only|structured output|return json)\b/i.test(String(message || '')),
    hasLocalEditIntent: !!d.should_use_monaco && !/\b(audit|clone|sandbox|full repo)\b/i.test(String(message || '')),
    requiresMcp: /\bmcp\b/i.test(String(message || '')),
  });

  d.sandbox_build_score = evalResult.score;
  d.sandbox_build_reasons = evalResult.reasons;
  d.sandbox_build_avoid_reasons = evalResult.avoidReasons;

  if (evalResult.recommend) {
    d.should_use_terminal = true;
    d.should_use_artifact_r2 = true;
    d.preferred_model_key = evalResult.model_key;
    if (d.execution_lane === 'none' || !d.execution_lane) {
      d.execution_lane = 'terminal';
    }
    const opt = Array.isArray(d.optional_capabilities) ? [...d.optional_capabilities] : [];
    if (!opt.includes('terminal')) opt.push('terminal');
    d.optional_capabilities = opt;
  }

  return d;
}

/**
 * Optional routing hint only — does not invent selection from UI chip names.
 * Prefer Antigravity as preferred_model_key when a caller already decided that preference.
 * @param {Record<string, unknown>} decision
 * @param {boolean} preferAntigravityModel
 */
export function applyComposerAntigravityToggle(decision, preferAntigravityModel) {
  const d = decision && typeof decision === 'object' ? { ...decision } : {};
  if (!preferAntigravityModel) return d;
  d.preferred_model_key = d.preferred_model_key || ANTIGRAVITY_MODEL_KEY;
  d.should_use_terminal = true;
  return d;
}
