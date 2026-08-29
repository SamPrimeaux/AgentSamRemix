/** Provider-neutral contracts for Agent Sam voice capabilities. */

export const VOICE_CAPABILITIES = Object.freeze({
  TRANSCRIBE_LIVE: 'speech.transcribe.live',
  TRANSCRIBE_FILE: 'speech.transcribe.file',
  SYNTHESIZE: 'speech.synthesize',
});

export const VOICE_FAILURE_CODES = Object.freeze({
  BAD_INPUT: 'bad_input',
  UNAUTHORIZED: 'unauthorized',
  MISCONFIGURED: 'misconfigured',
  DISABLED: 'disabled',
  QUOTA_EXHAUSTED: 'quota_exhausted',
  BUDGET_EXHAUSTED: 'budget_exhausted',
  RATE_LIMITED: 'rate_limited',
  TEMPORARILY_UNAVAILABLE: 'temporarily_unavailable',
  UPSTREAM_ERROR: 'upstream_error',
  CAPABILITY_UNAVAILABLE: 'capability_unavailable',
});

export class VoiceRouteError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'VoiceRouteError';
    this.code = code;
    this.provider = details.provider || null;
    this.modelKey = details.modelKey || null;
    this.status = Number(details.status) || 503;
    this.retryable = details.retryable === true;
  }
}

export function normalizeVoiceCapability(value) {
  const capability = String(value || '').trim().toLowerCase();
  if (Object.values(VOICE_CAPABILITIES).includes(capability)) return capability;
  throw new VoiceRouteError(
    VOICE_FAILURE_CODES.BAD_INPUT,
    `Unsupported voice capability "${capability || 'empty'}"`,
    { status: 400 },
  );
}

export function normalizeVoiceText(value, maxLength = 12000) {
  const text = String(value || '').trim();
  if (!text) {
    throw new VoiceRouteError(VOICE_FAILURE_CODES.BAD_INPUT, 'Voice text is required', {
      status: 400,
    });
  }
  return text.slice(0, maxLength);
}

export function classifyVoiceFailure(error, details = {}) {
  if (error instanceof VoiceRouteError) return error;
  const status = Number(details.status || error?.status || 0);
  const message = String(error?.message || error || 'Voice provider failed').slice(0, 500);
  const lower = message.toLowerCase();
  let code = VOICE_FAILURE_CODES.UPSTREAM_ERROR;
  if (status === 401 || status === 403) code = VOICE_FAILURE_CODES.UNAUTHORIZED;
  else if (status === 408 || status === 429) code = VOICE_FAILURE_CODES.RATE_LIMITED;
  else if (status >= 500) code = VOICE_FAILURE_CODES.TEMPORARILY_UNAVAILABLE;
  else if (/quota|resource exhausted/.test(lower)) code = VOICE_FAILURE_CODES.QUOTA_EXHAUSTED;
  else if (/budget/.test(lower)) code = VOICE_FAILURE_CODES.BUDGET_EXHAUSTED;
  else if (/api key|credential|not configured|missing/.test(lower)) {
    code = VOICE_FAILURE_CODES.MISCONFIGURED;
  }
  return new VoiceRouteError(code, message, {
    ...details,
    status: status || 503,
    retryable: [
      VOICE_FAILURE_CODES.MISCONFIGURED,
      VOICE_FAILURE_CODES.QUOTA_EXHAUSTED,
      VOICE_FAILURE_CODES.BUDGET_EXHAUSTED,
      VOICE_FAILURE_CODES.RATE_LIMITED,
      VOICE_FAILURE_CODES.TEMPORARILY_UNAVAILABLE,
    ].includes(code),
  });
}

export function isRoutableVoiceFailure(error) {
  return error instanceof VoiceRouteError && error.retryable === true;
}
