import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronDown, Mic, Settings2 } from 'lucide-react';
import { useComposerSpeechInput } from './useComposerSpeechInput';
import {
  useProviderIndependentVoice,
  type ProviderVoiceActivity,
} from './useProviderIndependentVoice';
import {
  loadVoicePrefs,
  REALTIME_VOICE_OPTIONS,
  saveVoicePrefs,
  VOICE_PERSONAS,
  type RealtimeVoiceId,
  type VoicePersonaId,
  type VoicePrefs,
} from './voiceOptions';

type AgentComposerMicButtonProps = {
  onTranscript: (text: string) => void;
  onAssistantTranscript?: (text: string, partial?: boolean) => void;
  onUserVoiceTranscript?: (text: string) => void;
  onVoiceActivity?: (activity: ProviderVoiceActivity) => void;
  onToolResult?: (toolName: string, preview: string) => void;
  onVoiceTurn?: (text: string) => Promise<void> | void;
  conversationId?: string | null;
  disabled?: boolean;
  /** Mobile keeps the engine mounted but only shows a stop affordance while voice/dictation is active. */
  compactActiveOnly?: boolean;
  /** Keep voice/dictation engines mounted for external mobile buttons without rendering duplicate controls. */
  eventBridgeOnly?: boolean;
};

/**
 * Composer voice controls:
 * - Voice = provider-neutral Agent Sam voice + options popover (voice/persona)
 * - Mic  = browser dictation
 * Meet/RealtimeKit is intentionally not used here.
 */
export function AgentComposerMicButton({
  onTranscript,
  onVoiceActivity,
  onVoiceTurn,
  disabled,
  compactActiveOnly = false,
}: AgentComposerMicButtonProps) {
  const [prefs, setPrefs] = useState<VoicePrefs>(() =>
    typeof window !== 'undefined' ? loadVoicePrefs() : { voiceId: 'alloy', personaId: 'operator' },
  );
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [dictationHint, setDictationHint] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveVoicePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (!optionsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOptionsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [optionsOpen]);

  const dictation = useComposerSpeechInput({
    onTranscript,
    onError: (msg) => {
      console.warn('[composer-mic]', msg);
      setDictationHint(msg);
    },
  });

  const realtime = useProviderIndependentVoice({
    onVoiceTurn,
    onActivity: onVoiceActivity,
    onError: (msg) => {
      console.warn('[composer-voice]', msg);
      setVoiceHint(msg);
    },
  });

  const onVoiceClick = useCallback(() => {
    setVoiceHint(null);
    setOptionsOpen(false);
    realtime.toggle();
  }, [realtime]);

  const onDictationClick = useCallback(() => {
    setDictationHint(null);
    if (realtime.active) realtime.stop();
    dictation.toggle();
  }, [dictation, realtime]);

  useEffect(() => {
    if (!compactActiveOnly || typeof window === 'undefined') return;
    const onVoiceToggle = () => {
      if (!disabled) onVoiceClick();
    };
    const onDictationToggle = () => {
      if (!disabled) onDictationClick();
    };
    const onPrefsChanged = () => setPrefs(loadVoicePrefs());
    window.addEventListener('iam:composer-voice-toggle', onVoiceToggle);
    window.addEventListener('iam:composer-dictation-toggle', onDictationToggle);
    window.addEventListener('iam:composer-voice-prefs-changed', onPrefsChanged);
    return () => {
      window.removeEventListener('iam:composer-voice-toggle', onVoiceToggle);
      window.removeEventListener('iam:composer-dictation-toggle', onDictationToggle);
      window.removeEventListener('iam:composer-voice-prefs-changed', onPrefsChanged);
    };
  }, [compactActiveOnly, disabled, onVoiceClick, onDictationClick]);

  const setVoiceId = (voiceId: RealtimeVoiceId) => {
    setPrefs((p) => ({ ...p, voiceId }));
  };
  const setPersonaId = (personaId: VoicePersonaId) => {
    setPrefs((p) => ({ ...p, personaId }));
  };

  const voiceTitle = realtime.connecting
    ? 'Connecting voice…'
    : realtime.speaking
      ? 'Sam is speaking — click to hang up'
      : realtime.listening || realtime.active
        ? 'Stop voice with Sam'
        : voiceHint
          ? `Voice with Sam — ${voiceHint}`
          : 'Voice with Sam';

  const showVoice = realtime.enabled !== false && realtime.status !== 'unavailable';
  const activityLabel = realtime.activity?.label;

  return (
    <div className="relative flex items-center gap-0.5 shrink-0" ref={popoverRef}>
      {showVoice && realtime.active && activityLabel ? (
        <span
          className={`hidden sm:inline-flex max-w-[9rem] truncate items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
            realtime.speaking
              ? 'text-[var(--solar-cyan)] bg-[color-mix(in_srgb,var(--solar-cyan)_14%,transparent)]'
              : realtime.activity.phase === 'error'
                ? 'text-[var(--solar-yellow,#eab308)] bg-[color-mix(in_srgb,var(--solar-yellow,#eab308)_14%,transparent)]'
                : 'text-[var(--solar-cyan)] bg-[color-mix(in_srgb,var(--solar-cyan)_14%,transparent)]'
          }`}
          title={activityLabel}
          data-testid="composer-voice-activity"
        >
          {activityLabel}
        </span>
      ) : null}

      {showVoice && (!compactActiveOnly || realtime.active || realtime.connecting) ? (
        <>
          <button
            type="button"
            className={`flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              realtime.active
                ? realtime.connecting
                  ? 'text-[var(--solar-cyan)] bg-[color-mix(in_srgb,var(--solar-cyan)_12%,transparent)]'
                  : 'text-red-500 bg-red-500/10 animate-pulse'
                : 'text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)]'
            } ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
            title={voiceTitle}
            aria-label={voiceTitle}
            aria-pressed={realtime.active}
            aria-busy={realtime.connecting || undefined}
            disabled={disabled}
            onClick={onVoiceClick}
            data-voice-mode="realtime"
            data-testid="composer-voice-realtime"
          >
            <AudioLines size={14} strokeWidth={2} />
            <span className="hidden sm:inline">Voice</span>
          </button>
          <button
            type="button"
            className={`flex-shrink-0 p-1 rounded-lg transition-all ${
              optionsOpen
                ? 'text-[var(--solar-cyan)] bg-[var(--bg-hover)]'
                : 'text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)]'
            } ${disabled || realtime.active ? 'opacity-40 pointer-events-none' : ''}`}
            title="Voice options (timbre & persona)"
            aria-label="Voice options"
            aria-expanded={optionsOpen}
            disabled={disabled || realtime.active}
            onClick={() => setOptionsOpen((o) => !o)}
            data-testid="composer-voice-options"
          >
            <Settings2 size={13} strokeWidth={2} />
          </button>
        </>
      ) : null}

      {dictation.supported && (!compactActiveOnly || dictation.listening) ? (
        <button
          type="button"
          className={`flex-shrink-0 p-1.5 rounded-lg transition-all ${
            dictation.listening
              ? 'text-red-500 bg-red-500/10 animate-pulse'
              : 'text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)]'
          } ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
          title={
            dictation.listening
              ? 'Stop dictation'
              : dictationHint
                ? `Talk to type — ${dictationHint}`
                : 'Talk to type'
          }
          aria-label={dictation.listening ? 'Stop dictation' : 'Talk to type'}
          aria-pressed={dictation.listening}
          disabled={disabled}
          onClick={onDictationClick}
          data-voice-mode="dictation"
          data-testid="composer-mic-dictation"
        >
          <Mic size={14} strokeWidth={2} />
        </button>
      ) : null}

      {optionsOpen ? (
        <div
          className="absolute bottom-full right-0 mb-2 z-50 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-[var(--border-subtle,rgba(255,255,255,0.08))] bg-[var(--dashboard-panel,#12141a)] shadow-xl p-3"
          role="dialog"
          aria-label="Voice options"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--dashboard-text)] mb-2">
            <ChevronDown size={12} className="opacity-50 rotate-180" />
            Voice options
          </div>
          <p className="text-[10px] text-[var(--dashboard-muted)] mb-2 leading-snug">
            Timbre + persona for Agent Sam Voice. Changes apply on the next Voice session. Meet stays
            RealtimeKit.
          </p>

          <div className="text-[10px] uppercase tracking-wide text-[var(--dashboard-muted)] mb-1">
            Persona
          </div>
          <div className="flex flex-col gap-1 mb-3">
            {VOICE_PERSONAS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPersonaId(p.id)}
                className={`text-left rounded-lg px-2 py-1.5 transition-colors ${
                  prefs.personaId === p.id
                    ? 'bg-[color-mix(in_srgb,var(--solar-cyan)_16%,transparent)] text-[var(--solar-cyan)]'
                    : 'hover:bg-[var(--bg-hover)] text-[var(--dashboard-text)]'
                }`}
              >
                <div className="text-[12px] font-medium">{p.label}</div>
                <div className="text-[10px] opacity-70">{p.blurb}</div>
              </button>
            ))}
          </div>

          <div className="text-[10px] uppercase tracking-wide text-[var(--dashboard-muted)] mb-1">
            Voice
          </div>
          <div className="grid grid-cols-3 gap-1 max-h-36 overflow-y-auto">
            {REALTIME_VOICE_OPTIONS.map((v) => (
              <button
                key={v.id}
                type="button"
                title={v.blurb}
                onClick={() => setVoiceId(v.id)}
                className={`rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition-colors ${
                  prefs.voiceId === v.id
                    ? 'bg-[color-mix(in_srgb,var(--solar-cyan)_16%,transparent)] text-[var(--solar-cyan)]'
                    : 'hover:bg-[var(--bg-hover)] text-[var(--dashboard-text)]'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
