/** Google Gemini prerecorded-audio transcription adapter. */

import { resolveProviderApiKey } from '../../../agentsam/providers/support/credentials.js';
import { classifyVoiceFailure, VOICE_FAILURE_CODES, VoiceRouteError } from '../../contracts.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function modelId(candidate) {
  return String(candidate?.provider_model_id || candidate?.model_key || '')
    .trim()
    .replace(/^models\//, '');
}

function encodeBase64(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let out = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    out += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(out);
}

export async function transcribeWithGemini(env, candidate, { bytes, mimeType } = {}) {
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
  const audio = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!audio.byteLength) {
    throw new VoiceRouteError(VOICE_FAILURE_CODES.BAD_INPUT, 'Audio payload is empty', { status: 400 });
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
        contents: [{
          parts: [
            { text: 'Transcribe this audio accurately. Return only the spoken words.' },
            { inlineData: { mimeType: mimeType || 'audio/webm', data: encodeBase64(audio) } },
          ],
        }],
      }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw classifyVoiceFailure(new Error(`Google transcription failed: ${detail}`), {
      provider: 'google',
      modelKey: candidate?.model_key,
      status: response.status,
    });
  }
  const body = await response.json().catch(() => ({}));
  const text = body?.candidates?.[0]?.content?.parts
    ?.filter((part) => part?.text)
    .map((part) => part.text)
    .join('')
    .trim() || '';
  if (!text) {
    throw new VoiceRouteError(VOICE_FAILURE_CODES.UPSTREAM_ERROR, 'Google returned no transcript', {
      provider: 'google',
      modelKey: candidate?.model_key,
      status: 502,
    });
  }
  return { provider: 'google', model: modelId(candidate), text };
}
