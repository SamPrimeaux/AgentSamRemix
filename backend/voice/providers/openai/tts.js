/** OpenAI text-to-speech adapter. */

import { resolveProviderApiKey, providerBaseUrl } from '../../../agentsam/providers/support/credentials.js';
import { classifyVoiceFailure, VOICE_FAILURE_CODES, VoiceRouteError } from '../../contracts.js';

export async function synthesizeWithOpenAI(env, candidate, { text, voice } = {}) {
  const apiKey = resolveProviderApiKey(env, 'openai', candidate?.secret_key_name);
  if (!apiKey) {
    throw new VoiceRouteError(VOICE_FAILURE_CODES.MISCONFIGURED, 'OpenAI API key not configured', {
      provider: 'openai',
      modelKey: candidate?.model_key,
      status: 503,
      retryable: true,
    });
  }
  const response = await fetch(`${providerBaseUrl('openai')}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: String(candidate?.provider_model_id || candidate?.model_key || '').trim(),
      input: String(text || ''),
      voice: String(voice || 'alloy').trim() || 'alloy',
      response_format: 'wav',
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw classifyVoiceFailure(new Error(`OpenAI TTS failed: ${detail}`), {
      provider: 'openai',
      modelKey: candidate?.model_key,
      status: response.status,
    });
  }
  return {
    provider: 'openai',
    model: candidate?.provider_model_id || candidate?.model_key,
    audio: new Uint8Array(await response.arrayBuffer()),
    mimeType: 'audio/wav',
  };
}
