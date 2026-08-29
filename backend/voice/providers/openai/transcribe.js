/** OpenAI audio transcription adapter. */

import { resolveProviderApiKey, providerBaseUrl } from '../../../agentsam/providers/support/credentials.js';
import { classifyVoiceFailure, VOICE_FAILURE_CODES, VoiceRouteError } from '../../contracts.js';

export async function transcribeWithOpenAI(env, candidate, { bytes, mimeType, filename } = {}) {
  const apiKey = resolveProviderApiKey(env, 'openai', candidate?.secret_key_name);
  if (!apiKey) {
    throw new VoiceRouteError(VOICE_FAILURE_CODES.MISCONFIGURED, 'OpenAI API key not configured', {
      provider: 'openai',
      modelKey: candidate?.model_key,
      status: 503,
      retryable: true,
    });
  }
  const audio = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!audio.byteLength) {
    throw new VoiceRouteError(VOICE_FAILURE_CODES.BAD_INPUT, 'Audio payload is empty', { status: 400 });
  }
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType || 'audio/webm' }), filename || 'voice.webm');
  form.append('model', String(candidate?.provider_model_id || candidate?.model_key || '').trim());
  form.append('response_format', 'json');
  const response = await fetch(`${providerBaseUrl('openai')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw classifyVoiceFailure(new Error(`OpenAI transcription failed: ${detail}`), {
      provider: 'openai',
      modelKey: candidate?.model_key,
      status: response.status,
    });
  }
  const body = await response.json().catch(() => ({}));
  const text = String(body?.text || '').trim();
  if (!text) {
    throw new VoiceRouteError(VOICE_FAILURE_CODES.UPSTREAM_ERROR, 'OpenAI returned no transcript', {
      provider: 'openai',
      modelKey: candidate?.model_key,
      status: 502,
    });
  }
  return { provider: 'openai', model: candidate?.provider_model_id || candidate?.model_key, text };
}
