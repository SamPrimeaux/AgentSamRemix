import { useCallback, useEffect, useRef, useState } from 'react';

const SESSION_URL = '/api/agent/voice/live/session';

function normalizeGeminiLiveMessage(payload: unknown) {
  const message = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const content = (message.serverContent || message.server_content || {}) as Record<string, unknown>;
  const input = (content.inputTranscription || content.input_transcription || null) as Record<string, unknown> | null;
  return {
    inputText: String(input?.text || '').trim(),
    turnComplete: content.turnComplete === true || content.turn_complete === true,
  };
}

export type ProviderVoiceStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'error'
  | 'unavailable';

export type ProviderVoiceActivity = {
  phase: ProviderVoiceStatus;
  label: string;
};

type AudioContextWithWebkit = typeof AudioContext & {
  new (): AudioContext;
};

function floatToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const sourceIndex = index * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(lower + 1, input.length - 1);
    const weight = sourceIndex - lower;
    output[index] = input[lower] * (1 - weight) + input[upper] * weight;
  }
  return output;
}

function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function appendTranscript(previous: string, next: string): string {
  const value = String(next || '').trim();
  if (!value) return previous;
  return previous ? `${previous} ${value}` : value;
}

export function useProviderIndependentVoice(options: {
  onVoiceTurn?: (text: string) => Promise<void> | void;
  onActivity?: (activity: ProviderVoiceActivity) => void;
  onError?: (message: string) => void;
  languageCodes?: string[];
} = {}) {
  const [status, setStatus] = useState<ProviderVoiceStatus>('idle');
  const [activity, setActivity] = useState<ProviderVoiceActivity>({
    phase: 'idle',
    label: 'Voice idle',
  });
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const startingRef = useRef(false);
  const transcriptRef = useRef('');
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const pushActivity = useCallback((next: ProviderVoiceActivity) => {
    setActivity(next);
    setStatus(next.phase);
    optionsRef.current.onActivity?.(next);
  }, []);

  const cleanup = useCallback(() => {
    try {
      socketRef.current?.close();
    } catch {
      /* ignore */
    }
    socketRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    transcriptRef.current = '';
    startingRef.current = false;
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setError(null);
    pushActivity({ phase: 'idle', label: 'Voice idle' });
  }, [cleanup, pushActivity]);

  const start = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (startingRef.current || status === 'connecting' || status === 'listening' || status === 'speaking') {
      return;
    }
    startingRef.current = true;
    setError(null);
    transcriptRef.current = '';
    pushActivity({ phase: 'connecting', label: 'Connecting voice…' });

    try {
      const tokenResponse = await fetch(SESSION_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languageCodes: optionsRef.current.languageCodes || [] }),
      });
      const session = (await tokenResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        error?: string;
        websocketUrl?: string;
        setup?: Record<string, unknown>;
      };
      if (tokenResponse.status === 403) {
        setEnabled(false);
        throw new Error(session.error || 'Voice is not available for this account.');
      }
      if (!tokenResponse.ok || !session.websocketUrl || !session.setup) {
        throw new Error(session.error || `Voice session failed (${tokenResponse.status})`);
      }
      setEnabled(true);

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = mediaStream;
      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: AudioContextWithWebkit }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error('Audio input is not supported in this browser.');
      const audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(mediaStream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const samples = downsample(event.inputBuffer.getChannelData(0), audioContext.sampleRate, 16000);
        const pcm = floatToPcm16(samples);
        try {
          socket.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: pcmToBase64(pcm) }],
            },
          }));
        } catch {
          /* socket close handler reports the transport failure */
        }
      };
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      processorRef.current = processor;

      const socket = new WebSocket(session.websocketUrl);
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify(session.setup));
        startingRef.current = false;
        pushActivity({ phase: 'listening', label: 'Listening…' });
      };
      socket.onmessage = (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const message = normalizeGeminiLiveMessage(payload);
        if (message.inputText) transcriptRef.current = appendTranscript(transcriptRef.current, message.inputText);
        if (message.turnComplete && transcriptRef.current) {
          const turn = transcriptRef.current.trim();
          transcriptRef.current = '';
          pushActivity({ phase: 'speaking', label: 'Agent Sam is responding…' });
          void Promise.resolve(optionsRef.current.onVoiceTurn?.(turn))
            .catch((caught) => {
              const messageText = caught instanceof Error ? caught.message : 'Voice turn failed.';
              setError(messageText);
              optionsRef.current.onError?.(messageText);
              pushActivity({ phase: 'error', label: messageText });
            })
            .finally(() => {
              if (socketRef.current === socket) pushActivity({ phase: 'listening', label: 'Listening…' });
            });
        }
      };
      socket.onerror = () => {
        const message = 'Gemini voice connection failed.';
        setError(message);
        optionsRef.current.onError?.(message);
        pushActivity({ phase: 'error', label: message });
      };
      socket.onclose = () => {
        if (socketRef.current === socket) {
          cleanup();
          pushActivity({ phase: 'idle', label: 'Voice idle' });
        }
      };
    } catch (caught) {
      cleanup();
      const message = caught instanceof Error ? caught.message : 'Could not start voice.';
      setError(message);
      optionsRef.current.onError?.(message);
      pushActivity({
        phase: message.toLowerCase().includes('available') ? 'unavailable' : 'error',
        label: message,
      });
    }
  }, [cleanup, pushActivity, status]);

  const toggle = useCallback(() => {
    if (status !== 'idle' && status !== 'error' && status !== 'unavailable') {
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
    active: status === 'connecting' || status === 'listening' || status === 'speaking',
    connecting: status === 'connecting',
    listening: status === 'listening',
    speaking: status === 'speaking',
    unavailable: status === 'unavailable' || enabled === false,
    toggle,
    start,
    stop,
  };
}
