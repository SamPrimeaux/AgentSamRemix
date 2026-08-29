/** Google Gemini Live transcription transport. */

import { resolveProviderApiKey } from '../../../agentsam/providers/support/credentials.js';
import {
  classifyVoiceFailure,
  VOICE_FAILURE_CODES,
  VoiceRouteError,
} from '../../contracts.js';

const TOKEN_URL = 'https://generativelanguage.googleapis.com/v1alpha/auth_tokens';
const LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.' +
  'GenerativeService.BidiGenerateContentConstrained';

function modelId(candidate) {
  return String(candidate?.provider_model_id || candidate?.model_key || '')
    .trim()
    .replace(/^models\//, '');
}

export function buildGeminiLiveSetup(candidate, options = {}) {
  const model = modelId(candidate);
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['TEXT'],
      },
      inputAudioTranscription: {},
      ...(options.languageCodes?.length
        ? { inputAudioTranscription: { languageCodes: options.languageCodes.slice(0, 8) } }
        : {}),
    },
  };
}

export function normalizeGeminiLiveMessage(payload) {
  const message = payload && typeof payload === 'object' ? payload : {};
  const content = message.serverContent || message.server_content || {};
  const input = content.inputTranscription || content.input_transcription || null;
  const output = content.outputTranscription || content.output_transcription || null;
  return {
    inputText: String(input?.text || '').trim(),
    outputText: String(output?.text || '').trim(),
    turnComplete: content.turnComplete === true || content.turn_complete === true,
    interrupted: content.interrupted === true,
  };
}

export async function createGeminiLiveSession(env, candidate, options = {}) {
  const apiKey =
    resolveProviderApiKey(env, 'google', candidate?.secret_key_name) ||
    String(env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || '').trim();
  if (!apiKey) {
    throw new VoiceRouteError(VOICE_FAILURE_CODES.MISCONFIGURED, 'Google AI API key not configured', {
      provider: 'google',
      modelKey: candidate?.model_key,
      status: 503,
      retryable: true,
    });
  }

  const now = Date.now();
  const setup = buildGeminiLiveSetup(candidate, options);
  const constrainedConfig = { ...setup.setup };
  delete constrainedConfig.model;
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
      liveConnectConstraints: {
        model: setup.setup.model,
        config: constrainedConfig,
      },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw classifyVoiceFailure(new Error(`Google Live token failed: ${detail}`), {
      provider: 'google',
      modelKey: candidate?.model_key,
      status: response.status,
    });
  }
  const body = await response.json().catch(() => ({}));
  const token = String(body?.name || body?.token || body?.access_token || '').trim();
  if (!token) {
    throw new VoiceRouteError(
      VOICE_FAILURE_CODES.UPSTREAM_ERROR,
      'Google Live token response did not include a token',
      { provider: 'google', modelKey: candidate?.model_key, status: 502 },
    );
  }

  const url = new URL(LIVE_WS_URL);
  url.searchParams.set('access_token', token);
  return {
    provider: 'google',
    model: modelId(candidate),
    token,
    websocketUrl: url.toString(),
    setup,
    expiresAt: body?.expireTime || body?.expire_time || null,
  };
}
