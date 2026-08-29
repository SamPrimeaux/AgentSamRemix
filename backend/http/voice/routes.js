/** Authenticated HTTP routes for provider-neutral Agent Sam voice. */

import { authUserFromRequest } from '../../identity/index.js';
import { jsonResponse } from '../agentsam/shared.js';
import { routeVoiceCapability } from '../../voice/router.js';
import {
  normalizeVoiceText,
  classifyVoiceFailure,
  VOICE_CAPABILITIES,
} from '../../voice/contracts.js';
import { createGeminiLiveSession } from '../../voice/providers/google/live.js';
import { transcribeWithGemini } from '../../voice/providers/google/transcribe.js';
import { synthesizeWithGemini } from '../../voice/providers/google/tts.js';
import { transcribeWithOpenAI } from '../../voice/providers/openai/transcribe.js';
import { synthesizeWithOpenAI } from '../../voice/providers/openai/tts.js';

function parsePreferences(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

function voiceErrorResponse(error) {
  const failure = classifyVoiceFailure(error);
  return jsonResponse(
    {
      ok: false,
      error: failure.message,
      code: failure.code,
      provider: failure.provider,
      model_key: failure.modelKey,
    },
    failure.status,
  );
}

async function requireVoiceUser(request, env, routeAuth) {
  return authUserFromRequest(
    request,
    env,
    routeAuth?.authCtx ?? null,
    routeAuth?.authUser ?? null,
  );
}

export async function handleAgentVoiceRoutes(
  request,
  url,
  env,
  _ctx,
  routeAuth = null,
) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  if (!path.startsWith('/api/agent/voice/')) return null;
  const user = await requireVoiceUser(request, env, routeAuth);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    if (path === '/api/agent/voice/live/session' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const preferences = parsePreferences(body?.preferences);
      const session = await routeVoiceCapability(env, {
        capability: VOICE_CAPABILITIES.TRANSCRIBE_LIVE,
        preferences,
      }, (candidate) => {
        if (candidate.provider !== 'google') {
          throw new Error(`Unsupported live transcription provider: ${candidate.provider}`);
        }
        return createGeminiLiveSession(env, candidate, {
          languageCodes: Array.isArray(body?.languageCodes) ? body.languageCodes : [],
        });
      });
      return jsonResponse({ ok: true, ...session });
    }

    if (path === '/api/agent/voice/transcribe' && method === 'POST') {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') {
        return jsonResponse({ ok: false, error: 'Audio file is required', code: 'bad_input' }, 400);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const preferences = parsePreferences(form.get('preferences'));
      const result = await routeVoiceCapability(
        env,
        { capability: VOICE_CAPABILITIES.TRANSCRIBE_FILE, preferences },
        (candidate) => {
          if (candidate.provider === 'google') {
            return transcribeWithGemini(env, candidate, { bytes, mimeType: file.type });
          }
          if (candidate.provider === 'openai') {
            return transcribeWithOpenAI(env, candidate, {
              bytes,
              mimeType: file.type,
              filename: file.name,
            });
          }
          throw new Error(`Unsupported file transcription provider: ${candidate.provider}`);
        },
      );
      return jsonResponse({ ok: true, ...result });
    }

    if (path === '/api/agent/voice/synthesize' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const text = normalizeVoiceText(body?.text);
      const preferences = parsePreferences(body?.preferences);
      const result = await routeVoiceCapability(
        env,
        { capability: VOICE_CAPABILITIES.SYNTHESIZE, preferences },
        (candidate) => {
          if (candidate.provider === 'google') {
            return synthesizeWithGemini(env, candidate, { text, voice: body?.voice });
          }
          if (candidate.provider === 'openai') {
            return synthesizeWithOpenAI(env, candidate, { text, voice: body?.voice });
          }
          throw new Error(`Unsupported speech synthesis provider: ${candidate.provider}`);
        },
      );
      return jsonResponse({
        ok: true,
        provider: result.provider,
        model: result.model,
        mimeType: result.mimeType,
        sampleRate: result.sampleRate || null,
        audioBase64: encodeBase64(result.audio),
      });
    }
  } catch (error) {
    return voiceErrorResponse(error);
  }
  return null;
}
