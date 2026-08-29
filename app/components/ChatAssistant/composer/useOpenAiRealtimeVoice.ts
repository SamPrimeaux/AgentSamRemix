import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_TOOL_DEFINITIONS } from './voiceOptions';

const CLIENT_SECRET_URL = '/api/openai/realtime/client-secret';
const OPENAI_REALTIME_CALLS = 'https://api.openai.com/v1/realtime/calls';
const EXECUTE_TOOL_URL = '/api/agent/chat/execute-approved-tool';

export type RealtimeVoiceStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'tool'
  | 'error'
  | 'unavailable';

export type RealtimeVoiceActivity = {
  phase: RealtimeVoiceStatus;
  label: string;
  toolName?: string | null;
};

type RealtimeServerEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  error?: { message?: string };
  item?: {
    type?: string;
    role?: string;
    name?: string;
    call_id?: string;
    arguments?: string;
    content?: Array<{ type?: string; transcript?: string; text?: string }>;
  };
  response?: {
    status?: string;
    output?: Array<{
      type?: string;
      name?: string;
      call_id?: string;
      arguments?: string;
    }>;
  };
};

function extractEphemeralKey(payload: Record<string, unknown> | null): string {
  if (!payload || typeof payload !== 'object') return '';
  const top = typeof payload.value === 'string' ? payload.value.trim() : '';
  if (top) return top;
  const nested = payload.client_secret;
  if (nested && typeof nested === 'object' && nested !== null) {
    const v = (nested as { value?: unknown }).value;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function sendDc(dc: RTCDataChannel | null, payload: Record<string, unknown>) {
  if (!dc || dc.readyState !== 'open') return;
  try {
    dc.send(JSON.stringify(payload));
  } catch (e) {
    console.warn('[realtime-voice] dc_send_failed', e);
  }
}

async function executeVoiceTool(
  toolName: string,
  argsJson: string,
  conversationId?: string | null,
): Promise<string> {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(argsJson || '{}') as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const res = await fetch(EXECUTE_TOOL_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool_name: toolName,
      tool_input: parsed,
      conversation_id: conversationId || undefined,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    result?: unknown;
  };
  if (!res.ok || body.success === false) {
    return JSON.stringify({
      ok: false,
      error: body.error || `Tool failed (${res.status})`,
    });
  }
  const result =
    typeof body.result === 'string' ? body.result : JSON.stringify(body.result ?? null);
  return JSON.stringify({
    ok: true,
    result: result.slice(0, 12000),
  });
}

/**
 * Agent Sam Voice — OpenAI Realtime over WebRTC (not Meet/RealtimeKit).
 * Transcripts, activity phases, and a small read-only tool bridge.
 */
export function useOpenAiRealtimeVoice(options: {
  onUserTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string, partial?: boolean) => void;
  onActivity?: (activity: RealtimeVoiceActivity) => void;
  onToolResult?: (toolName: string, preview: string) => void;
  onError?: (message: string) => void;
  instructions?: string;
  voice?: string;
  conversationId?: string | null;
  enableTools?: boolean;
} = {}) {
  const {
    onUserTranscript,
    onAssistantTranscript,
    onActivity,
    onToolResult,
    onError,
    instructions,
    voice,
    conversationId,
    enableTools = true,
  } = options;

  const [status, setStatus] = useState<RealtimeVoiceStatus>('idle');
  const [activity, setActivity] = useState<RealtimeVoiceActivity>({
    phase: 'idle',
    label: 'Voice idle',
  });
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [partialAssistant, setPartialAssistant] = useState('');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const startingRef = useRef(false);
  const pendingCallsRef = useRef<Set<string>>(new Set());
  const assistantBufRef = useRef('');

  const optsRef = useRef(options);
  optsRef.current = options;

  const pushActivity = useCallback((next: RealtimeVoiceActivity) => {
    setActivity(next);
    setStatus(next.phase);
    optsRef.current.onActivity?.(next);
  }, []);

  const cleanup = useCallback(() => {
    try {
      dcRef.current?.close();
    } catch {
      /* ignore */
    }
    dcRef.current = null;
    try {
      pcRef.current?.close();
    } catch {
      /* ignore */
    }
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }
    startingRef.current = false;
    pendingCallsRef.current.clear();
    assistantBufRef.current = '';
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setError(null);
    setPartialAssistant('');
    pushActivity({ phase: 'idle', label: 'Voice idle' });
  }, [cleanup, pushActivity]);

  const handleFunctionCalls = useCallback(
    async (
      calls: Array<{ name?: string; call_id?: string; arguments?: string }>,
      dc: RTCDataChannel,
    ) => {
      for (const call of calls) {
        const name = String(call.name || '').trim();
        const callId = String(call.call_id || '').trim();
        if (!name || !callId) continue;
        if (pendingCallsRef.current.has(callId)) continue;
        pendingCallsRef.current.add(callId);

        pushActivity({
          phase: 'tool',
          label: `Running ${name}…`,
          toolName: name,
        });

        const output = await executeVoiceTool(
          name,
          call.arguments || '{}',
          optsRef.current.conversationId,
        );
        optsRef.current.onToolResult?.(name, output.slice(0, 500));

        sendDc(dc, {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output,
          },
        });
        pendingCallsRef.current.delete(callId);
      }
      sendDc(dc, { type: 'response.create' });
      pushActivity({ phase: 'listening', label: 'Listening…' });
    },
    [pushActivity],
  );

  const onServerEvent = useCallback(
    (ev: RealtimeServerEvent, dc: RTCDataChannel) => {
      const t = String(ev.type || '');

      if (t === 'error' || ev.error?.message) {
        const msg = ev.error?.message || 'Realtime session error';
        setError(msg);
        optsRef.current.onError?.(msg);
        pushActivity({ phase: 'error', label: msg });
        return;
      }

      if (t === 'session.created' || t === 'session.updated') {
        pushActivity({ phase: 'listening', label: 'Listening…' });
        return;
      }

      if (t === 'input_audio_buffer.speech_started') {
        pushActivity({ phase: 'listening', label: 'Hearing you…' });
        return;
      }

      if (t === 'response.created' || t === 'response.output_audio.delta' || t === 'response.audio.delta') {
        pushActivity({ phase: 'speaking', label: 'Sam speaking…' });
        return;
      }

      if (t === 'response.output_audio_transcript.delta' || t === 'response.audio_transcript.delta') {
        const d = String(ev.delta || '');
        if (d) {
          assistantBufRef.current += d;
          setPartialAssistant(assistantBufRef.current);
          optsRef.current.onAssistantTranscript?.(assistantBufRef.current, true);
        }
        pushActivity({ phase: 'speaking', label: 'Sam speaking…' });
        return;
      }

      if (t === 'conversation.item.input_audio_transcription.completed' && ev.transcript?.trim()) {
        optsRef.current.onUserTranscript?.(ev.transcript.trim());
        return;
      }

      if (
        (t === 'response.output_audio_transcript.done' || t === 'response.audio_transcript.done') &&
        (ev.transcript?.trim() || assistantBufRef.current)
      ) {
        const finalText = (ev.transcript || assistantBufRef.current).trim();
        assistantBufRef.current = '';
        setPartialAssistant('');
        if (finalText) optsRef.current.onAssistantTranscript?.(finalText, false);
        return;
      }

      if (t === 'response.done') {
        const outputs = ev.response?.output || [];
        const calls = outputs.filter((o) => o.type === 'function_call');
        if (calls.length && optsRef.current.enableTools !== false) {
          void handleFunctionCalls(calls, dc);
          return;
        }
        pushActivity({ phase: 'listening', label: 'Listening…' });
        return;
      }

      if (t === 'response.function_call_arguments.done' && ev.call_id && ev.name) {
        if (optsRef.current.enableTools === false) return;
        void handleFunctionCalls(
          [{ name: ev.name, call_id: ev.call_id, arguments: ev.arguments }],
          dc,
        );
      }
    },
    [handleFunctionCalls, pushActivity],
  );

  const start = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (startingRef.current || status === 'connecting' || status === 'listening' || status === 'speaking') {
      return;
    }
    startingRef.current = true;
    setError(null);
    setPartialAssistant('');
    assistantBufRef.current = '';
    pushActivity({ phase: 'connecting', label: 'Connecting voice…' });

    try {
      const tokenRes = await fetch(CLIENT_SECRET_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(voice ? { voice } : {}),
          ...(instructions ? { instructions } : {}),
        }),
      });

      if (tokenRes.status === 403) {
        setEnabled(false);
        startingRef.current = false;
        pushActivity({ phase: 'unavailable', label: 'Voice unavailable' });
        optsRef.current.onError?.(
          (await tokenRes.json().catch(() => ({})) as { code?: string })?.code === 'flag_off'
            ? 'Voice is not enabled for this account.'
            : 'Voice is not available.',
        );
        return;
      }

      if (!tokenRes.ok) {
        const body = (await tokenRes.json().catch(() => ({}))) as { error?: string; detail?: string };
        const msg = body.detail || body.error || `Voice secret failed (${tokenRes.status})`;
        startingRef.current = false;
        setError(msg);
        pushActivity({ phase: 'error', label: msg });
        optsRef.current.onError?.(msg);
        return;
      }

      setEnabled(true);
      const ephemeralKey = extractEphemeralKey((await tokenRes.json()) as Record<string, unknown>);
      if (!ephemeralKey) {
        const msg = 'Voice secret missing value.';
        startingRef.current = false;
        setError(msg);
        pushActivity({ phase: 'error', label: msg });
        optsRef.current.onError?.(msg);
        return;
      }

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.setAttribute('playsinline', 'true');
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0] ?? null;
        void audioEl.play().catch(() => {});
      };

      const ms = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = ms;
      for (const track of ms.getTracks()) pc.addTrack(track, ms);

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.addEventListener('open', () => {
        if (enableTools) {
          sendDc(dc, {
            type: 'session.update',
            session: {
              tools: VOICE_TOOL_DEFINITIONS,
              tool_choice: 'auto',
              instructions: instructions || undefined,
            },
          });
        }
        pushActivity({ phase: 'listening', label: 'Listening…' });
      });

      dc.addEventListener('message', (e) => {
        try {
          const ev = JSON.parse(String(e.data)) as RealtimeServerEvent;
          onServerEvent(ev, dc);
        } catch {
          /* ignore */
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(OPENAI_REALTIME_CALLS, {
        method: 'POST',
        body: offer.sdp ?? '',
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpResponse.ok) {
        const errText = await sdpResponse.text().catch(() => '');
        const msg = `OpenAI Realtime call failed (${sdpResponse.status})${errText ? `: ${errText.slice(0, 200)}` : ''}`;
        cleanup();
        setError(msg);
        pushActivity({ phase: 'error', label: msg });
        optsRef.current.onError?.(msg);
        return;
      }

      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
      startingRef.current = false;
      pushActivity({ phase: 'listening', label: 'Listening…' });
    } catch (e) {
      cleanup();
      const msg =
        e instanceof Error ? e.message : 'Could not start voice — check microphone permissions.';
      setError(msg);
      pushActivity({ phase: 'error', label: msg });
      optsRef.current.onError?.(msg);
      startingRef.current = false;
    }
  }, [
    cleanup,
    enableTools,
    instructions,
    onServerEvent,
    pushActivity,
    status,
    voice,
  ]);

  const toggle = useCallback(() => {
    if (
      status === 'listening' ||
      status === 'connecting' ||
      status === 'speaking' ||
      status === 'tool'
    ) {
      stop();
      return;
    }
    void start();
  }, [start, status, stop]);

  useEffect(() => () => cleanup(), [cleanup]);

  return {
    status,
    activity,
    error,
    enabled,
    partialAssistant,
    active:
      status === 'listening' ||
      status === 'connecting' ||
      status === 'speaking' ||
      status === 'tool',
    connecting: status === 'connecting',
    listening: status === 'listening',
    speaking: status === 'speaking',
    unavailable: status === 'unavailable' || enabled === false,
    toggle,
    start,
    stop,
  };
}
