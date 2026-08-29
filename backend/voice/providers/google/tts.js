/** Google Gemini text-to-speech adapter. */

import { resolveProviderApiKey } from '../../../agentsam/providers/support/credentials.js';
import { classifyVoiceFailure, VOICE_FAILURE_CODES, VoiceRouteError } from '../../contracts.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_VOICE = 'Kore';

function modelId(candidate) {
  return String(candidate?.provider_model_id || candidate?.model_key || '')
    .trim()
    .replace(/^models\//, '');
}

function decodeBase64(value) {
  const raw = atob(String(value || ''));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export async function synthesizeWithGemini(env, candidate, { text, voice } = {}) {
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
  const response = await fetch(
    `${BASE_URL}/${encodeURIComponent(modelId(candidate))}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: String(text || '') }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: String(voice || DEFAULT_VOICE).trim() || DEFAULT_VOICE },
            },
          },
        },
      }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw classifyVoiceFailure(new Error(`Google TTS failed: ${detail}`), {
      provider: 'google',
      modelKey: candidate?.model_key,
      status: response.status,
    });
  }
  const body = await response.json().catch(() => ({}));
  const part = body?.candidates?.[0]?.content?.parts?.find((item) => item?.inlineData?.data);
  const data = part?.inlineData;
  if (!data?.data) {
    throw new VoiceRouteError(VOICE_FAILURE_CODES.UPSTREAM_ERROR, 'Google TTS returned no audio', {
      provider: 'google',
      modelKey: candidate?.model_key,
      status: 502,
    });
  }
  return {
    provider: 'google',
    model: modelId(candidate),
    audio: decodeBase64(data.data),
    mimeType: String(data.mimeType || 'audio/pcm;rate=24000'),
    sampleRate: 24000,
  };
}
