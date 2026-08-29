/** Catalog policy for selecting a voice capability provider. */

import {
  VOICE_CAPABILITIES,
  VOICE_FAILURE_CODES,
  VoiceRouteError,
} from './contracts.js';

const CAPABILITY_LANES = Object.freeze({
  [VOICE_CAPABILITIES.TRANSCRIBE_LIVE]: new Set(['voice', 'audio', 'speech', 'transcription']),
  [VOICE_CAPABILITIES.TRANSCRIBE_FILE]: new Set(['transcription', 'audio', 'speech']),
  [VOICE_CAPABILITIES.SYNTHESIZE]: new Set(['tts', 'voice', 'audio', 'speech']),
});

const PROVIDER_CAPABILITIES = Object.freeze({
  google: new Set(Object.values(VOICE_CAPABILITIES)),
  openai: new Set([VOICE_CAPABILITIES.TRANSCRIBE_FILE, VOICE_CAPABILITIES.SYNTHESIZE]),
});

function tokenMatchesCapability(modelKey, capability) {
  const key = String(modelKey || '').toLowerCase();
  if (capability === VOICE_CAPABILITIES.TRANSCRIBE_LIVE) {
    return /live|realtime|transcrib/.test(key);
  }
  if (capability === VOICE_CAPABILITIES.TRANSCRIBE_FILE) {
    return /transcrib|whisper|speech/.test(key);
  }
  return /tts|speech|audio|voice/.test(key);
}

export function catalogRowSupportsVoiceCapability(row, capability) {
  const lane = String(row?.routing_lane || '').trim().toLowerCase();
  const allowedLanes = CAPABILITY_LANES[capability];
  if (!allowedLanes) return false;
  return (
    PROVIDER_CAPABILITIES[String(row?.provider || '').trim().toLowerCase()]?.has(capability) === true &&
    allowedLanes.has(lane) &&
    tokenMatchesCapability(row?.model_key, capability) &&
    (capability !== VOICE_CAPABILITIES.TRANSCRIBE_LIVE ||
      Number(row?.supports_realtime) === 1)
  );
}

export function catalogRowIsUsable(row) {
  if (!row || Number(row.is_active) === 0) return false;
  if (Number(row.is_degraded) === 1 || Number(row.budget_exhausted) === 1) return false;
  return true;
}

export function providerPreferenceOrder(preferences = {}) {
  const preferred = String(preferences.preferred || '').trim().toLowerCase();
  const fallback = Array.isArray(preferences.fallback) ? preferences.fallback : [];
  return [...new Set([preferred, ...fallback, 'google', 'openai'].map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
}

export function orderVoiceCandidates(rows, preferences = {}) {
  const order = providerPreferenceOrder(preferences);
  return [...rows].sort((a, b) => {
    const providerA = order.indexOf(String(a.provider || '').toLowerCase());
    const providerB = order.indexOf(String(b.provider || '').toLowerCase());
    const rankA = providerA < 0 ? order.length : providerA;
    const rankB = providerB < 0 ? order.length : providerB;
    if (rankA !== rankB) return rankA - rankB;
    return String(a.model_key || '').localeCompare(String(b.model_key || ''));
  });
}

export function assertVoiceCandidate(candidate, capability) {
  if (candidate && catalogRowIsUsable(candidate) && catalogRowSupportsVoiceCapability(candidate, capability)) {
    return candidate;
  }
  throw new VoiceRouteError(
    VOICE_FAILURE_CODES.CAPABILITY_UNAVAILABLE,
    `No active provider supports ${capability}`,
    { status: 503 },
  );
}
