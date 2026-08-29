import React, { useState, useEffect, useRef } from 'react';
import { Check, X, AlertTriangle, Lock, ChevronDown } from 'lucide-react';
import type { AgentMode } from '../../components/ChatAssistant/types';
import { AgentModePresenceIcon } from '../../features/mode-presence/AgentModePresenceIcon';
import { resolveAgentPresence } from '../../features/agent-run/resolveAgentPresence';
import { toolNameToLane } from '../../features/agent-run/lanes';
import '../../features/agent-run/agentRunPresence.css';

export type ThinkingStepStatus = 'running' | 'done' | 'error' | 'blocked';

export interface ThinkingStep {
  id: string;
  name: string;
  status: ThinkingStepStatus;
  preview?: string;
}

export type ThinkingCardStatus = 'thinking' | 'working' | 'blocked' | 'done' | 'error';

export interface ThinkingCardState {
  steps: ThinkingStep[];
  thinkingText: string;
  status: ThinkingCardStatus;
  startedAt: number;
  /** Plan-mode thinking indicator (16px inline label). */
  surface?: 'plan' | 'terminal' | null;
}

export interface ThinkingCardProps extends ThinkingCardState {
  className?: string;
  mode?: AgentMode;
  presenceState?: string | null;
}

function statusPill(status: ThinkingCardStatus): string {
  if (status === 'blocked') return 'approval';
  if (status === 'error') return 'error';
  if (status === 'done') return 'done';
  return 'working';
}

function stepLaneFromText(step: ThinkingStep) {
  return toolNameToLane(`${step.name} ${step.preview || ''}`);
}

export function ThinkingCard({
  steps,
  thinkingText,
  status,
  startedAt,
  className = '',
  mode = 'agent',
  presenceState,
}: ThinkingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDone = status === 'done';
  const isError = status === 'error';
  const isBlocked = status === 'blocked';
  const isActive = !isDone && !isError;

  useEffect(() => {
    if (isDone || isError) {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(Date.now() - startedAt);
      const t = setTimeout(() => setExpanded(false), 2000);
      return () => clearTimeout(t);
    }
    timerRef.current = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, startedAt, isDone, isError]);

  const elapsedStr = (elapsed / 1000).toFixed(1) + 's';
  const stepCount = steps.length;

  const resolved = resolveAgentPresence({
    mode,
    presenceState:
      presenceState ||
      (isBlocked ? 'approval_required' : isDone ? 'complete' : isError ? 'failed' : 'thinking'),
    status: isDone ? 'done' : isError ? 'failed' : isBlocked ? 'waiting' : 'active',
    phase: isBlocked ? 'gated' : isDone ? 'complete' : isError ? 'failed' : 'thinking',
    title: isError
      ? 'Stopped — something needs attention.'
      : isBlocked
        ? 'Waiting for your approval'
        : isDone
          ? 'Done'
          : thinkingText
            ? thinkingText.length > 120
              ? thinkingText.slice(0, 117) + '…'
              : thinkingText
            : undefined,
  });

  const metaParts = [
    resolved.presenceState.replace(/_/g, ' '),
    isActive ? elapsedStr : null,
    stepCount > 0 ? `${stepCount} step${stepCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  const shellClass = [
    'iam-agent-run-thinking',
    isBlocked ? 'iam-agent-run-thinking--blocked' : '',
    isError ? 'iam-agent-run-thinking--error' : '',
    isDone ? 'iam-agent-run-thinking--done' : '',
    expanded ? 'is-expanded' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClass} role="status" aria-live="polite">
      <button
        type="button"
        className="iam-agent-run-thinking__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="iam-agent-run-thinking__icon" aria-hidden>
          {isError ? (
            <AlertTriangle size={28} style={{ color: 'var(--solar-red, #f87171)' }} />
          ) : isBlocked ? (
            <Lock size={26} style={{ color: 'var(--solar-yellow, #fbbf24)' }} />
          ) : (
            <AgentModePresenceIcon
              mode={mode}
              state={resolved.presenceState}
              iconKey={resolved.iconKey}
              size={44}
              motion={isActive}
              aria-label=""
            />
          )}
        </span>

        <span className="iam-agent-run-thinking__main">
          <span className="iam-agent-run-thinking__title">{resolved.label}</span>
          {metaParts.length > 0 ? (
            <span className="iam-agent-run-thinking__meta">{metaParts.join(' · ')}</span>
          ) : null}
        </span>

        <span className="iam-agent-run-thinking__pill">{statusPill(status)}</span>

        <span className="iam-agent-run-thinking__chev" aria-hidden>
          <ChevronDown size={14} />
        </span>
      </button>

      {expanded ? (
        <div className="iam-agent-run-thinking__trace">
          {thinkingText ? (
            <div className="iam-agent-run-thinking__trace-note">
              {thinkingText.length > 320 ? thinkingText.slice(0, 317) + '…' : thinkingText}
            </div>
          ) : null}

          {steps.map((step) => (
            <div key={step.id} className="iam-agent-run-thinking__step">
              <span className="iam-agent-run-thinking__step-icon" aria-hidden>
                {step.status === 'done' ? (
                  <Check size={14} style={{ color: 'var(--solar-green, #34d399)' }} />
                ) : step.status === 'error' ? (
                  <X size={14} style={{ color: 'var(--solar-red, #f87171)' }} />
                ) : step.status === 'blocked' ? (
                  <AlertTriangle size={14} style={{ color: 'var(--solar-yellow, #fbbf24)' }} />
                ) : (
                  <AgentModePresenceIcon
                    mode={mode}
                    state={stepLaneFromText(step) === 'terminal' ? 'terminal' : 'tool_routing'}
                    size={44}
                    motion
                    aria-label=""
                  />
                )}
              </span>
              <div className="min-w-0">
                <div className="iam-agent-run-thinking__step-name">{step.name}</div>
                {step.preview ? (
                  <div className="iam-agent-run-thinking__step-preview">{step.preview}</div>
                ) : null}
              </div>
            </div>
          ))}

          {isActive && steps.length === 0 ? (
            <div className="iam-agent-run-thinking__trace-note">Starting…</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
