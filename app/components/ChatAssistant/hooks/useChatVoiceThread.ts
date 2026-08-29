/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Realtime voice → local chat bubbles.
 */

import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Message } from '../types';
import { syncComposerTextareaHeight } from '../composerLayout';
import { COMPOSER_TEXTAREA_MAX_PX_NARROW, COMPOSER_TEXTAREA_MAX_PX_WIDE } from '../types';

function decodeBase64(value: string): Uint8Array {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  const view = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) view[index] = bytes[index];
  return buffer;
}

function pcmToWav(pcm: Uint8Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: 'audio/wav' });
}

export function useChatVoiceThread(args: {
  setInput: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isNarrow: boolean;
}) {
  const { setInput, setMessages, textareaRef, isNarrow } = args;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const appendSpeechToInput = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setInput((prev) => {
        const sep = prev && !prev.endsWith(' ') ? ' ' : '';
        return prev + sep + t;
      });
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          syncComposerTextareaHeight(
            el,
            isNarrow ? COMPOSER_TEXTAREA_MAX_PX_NARROW : COMPOSER_TEXTAREA_MAX_PX_WIDE,
          );
        }
      });
    },
    [isNarrow],
  );

  /** Realtime voice → chat bubbles (local thread; not /api/agent/chat). */
  const voiceAssistantIdxRef = useRef<number | null>(null);

  const appendVoiceUserToThread = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      voiceAssistantIdxRef.current = null;
      setMessages((prev) => [...prev, { role: 'user', content: t }]);
    },
    [setMessages],
  );

  const appendVoiceAssistantToThread = useCallback(
    (text: string, partial?: boolean) => {
      const t = text.trim();
      if (!t) return;
      setMessages((prev) => {
        const next = [...prev];
        const idx = voiceAssistantIdxRef.current;
        if (idx != null && idx >= 0 && idx < next.length && next[idx]?.role === 'assistant') {
          next[idx] = { ...next[idx], content: t };
          if (!partial) voiceAssistantIdxRef.current = null;
          return next;
        }
        voiceAssistantIdxRef.current = next.length;
        const out = [...next, { role: 'assistant' as const, content: t }];
        if (!partial) voiceAssistantIdxRef.current = null;
        return out;
      });
    },
    [setMessages],
  );

  const onVoiceToolResult = useCallback(
    (toolName: string, preview: string) => {
      voiceAssistantIdxRef.current = null;
      let pretty = preview;
      try {
        pretty = JSON.stringify(JSON.parse(preview), null, 2);
      } catch {
        /* keep raw */
      }
      const short = pretty.length > 400 ? `${pretty.slice(0, 400)}…` : pretty;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `🔧 Voice tool \`${toolName}\`\n\`\`\`json\n${short}\n\`\`\``,
        },
      ]);
    },
    [setMessages],
  );

  const speakAssistantText = useCallback(async (text: string) => {
    const value = text.trim();
    if (!value || typeof window === 'undefined') return;
    try {
      const response = await fetch('/api/agent/voice/synthesize', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => ({}))) as {
        audioBase64?: string;
        mimeType?: string;
        sampleRate?: number | null;
      };
      if (!payload.audioBase64) return;
      audioRef.current?.pause();
      const bytes = decodeBase64(payload.audioBase64);
      const mimeType = String(payload.mimeType || 'audio/wav');
      const blob = mimeType.startsWith('audio/pcm')
        ? pcmToWav(bytes, Number(payload.sampleRate) || 24000)
        : new Blob([copyToArrayBuffer(bytes)], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      }, { once: true });
      await audio.play().catch(() => undefined);
    } catch {
      /* Voice remains usable as text when TTS is unavailable or autoplay is blocked. */
    }
  }, []);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  return {
    appendSpeechToInput,
    appendVoiceUserToThread,
    appendVoiceAssistantToThread,
    onVoiceToolResult,
    speakAssistantText,
  };
}
