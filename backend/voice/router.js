/** D1-backed capability routing for voice providers. */

import { providerModelIdFromCatalogRow } from '../agentsam/catalog/model-identity.js';
import {
  classifyVoiceFailure,
  isRoutableVoiceFailure,
  normalizeVoiceCapability,
  VOICE_FAILURE_CODES,
  VoiceRouteError,
} from './contracts.js';
import {
  catalogRowIsUsable,
  catalogRowSupportsVoiceCapability,
  orderVoiceCandidates,
  assertVoiceCandidate,
} from './policy.js';

async function loadCatalogRows(env) {
  if (!env?.DB) {
    throw new VoiceRouteError(VOICE_FAILURE_CODES.MISCONFIGURED, 'Voice catalog database is unavailable', {
      status: 503,
    });
  }
  const result = await env.DB.prepare(
    `SELECT * FROM agentsam_model_catalog
     WHERE COALESCE(is_active, 1) = 1
     ORDER BY model_key ASC`,
  ).all();
  return Array.isArray(result?.results) ? result.results : [];
}

function normalizeCandidate(row) {
  return {
    ...row,
    provider: String(row.provider || '').trim().toLowerCase(),
    model_key: String(row.model_key || '').trim(),
    provider_model_id: providerModelIdFromCatalogRow(row),
  };
}

export async function resolveVoiceCandidates(env, { capability, preferences } = {}) {
  const normalizedCapability = normalizeVoiceCapability(capability);
  const rows = (await loadCatalogRows(env))
    .map(normalizeCandidate)
    .filter(
      (row) =>
        catalogRowIsUsable(row) &&
        catalogRowSupportsVoiceCapability(row, normalizedCapability),
    );
  return orderVoiceCandidates(rows, preferences);
}

export async function resolveVoiceCapability(env, options = {}) {
  const candidates = await resolveVoiceCandidates(env, options);
  return assertVoiceCandidate(candidates[0], normalizeVoiceCapability(options.capability));
}

/**
 * Run one capability operation and fail over only for provider availability failures.
 * The operation receives a normalized catalog candidate.
 */
export async function routeVoiceCapability(env, options = {}, operation) {
  if (typeof operation !== 'function') {
    throw new TypeError('routeVoiceCapability operation is required');
  }
  const capability = normalizeVoiceCapability(options.capability);
  const candidates = await resolveVoiceCandidates(env, { ...options, capability });
  if (!candidates.length) {
    throw new VoiceRouteError(
      VOICE_FAILURE_CODES.CAPABILITY_UNAVAILABLE,
      `No active provider supports ${capability}`,
      { status: 503 },
    );
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await operation(candidate);
    } catch (error) {
      const classified = classifyVoiceFailure(error, {
        provider: candidate.provider,
        modelKey: candidate.model_key,
      });
      lastError = classified;
      if (!isRoutableVoiceFailure(classified)) throw classified;
    }
  }
  throw lastError || new VoiceRouteError(
    VOICE_FAILURE_CODES.CAPABILITY_UNAVAILABLE,
    `No healthy provider completed ${capability}`,
    { status: 503 },
  );
}
