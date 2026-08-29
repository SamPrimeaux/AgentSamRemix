import React, { useMemo } from 'react';
import type { AgentMode, AgentPresenceState, ModePresenceIconKey } from './agentModePresenceMap';
import { resolvePresenceIconKey } from './agentModePresenceMap';
import { PRESENCE_ICON_SVG } from '../agent-presence/presenceIcons';
import type { AgentPresenceIcon } from '../agent-presence/iamPresenceStateMap';

function toModeSvg(html: string): string {
  return html.replace(/\biam-presence-icon\b/g, 'iam-mode-presence-icon');
}

/** Legacy lab icons (100×100) bridged into mode-presence slot. */
const LEGACY_LAB_ICONS: Partial<Record<ModePresenceIconKey, AgentPresenceIcon>> = {
  'agent-spark': 'agent-spark',
  scan: 'scan',
  terminal: 'terminal',
  diff: 'diff',
  browser: 'browser',
  files: 'files',
  path: 'path',
  pixel: 'pixel',
  'subagent-swarm': 'subagent-swarm',
  'fanout-orbit': 'fanout-orbit',
  'delegate-chain': 'delegate-chain',
  'work-queue': 'work-queue',
  'tool-router': 'tool-router',
  'review-gate': 'review-gate',
  'approval-wait': 'approval-wait',
  'done-bloom': 'done-bloom',
  'error-signal': 'error-signal',
  'skeleton-plan': 'skeleton-plan',
  'merge-weave': 'merge-weave',
};

function legacyModeSvg(key: ModePresenceIconKey): string | undefined {
  const legacyKey = LEGACY_LAB_ICONS[key];
  if (!legacyKey || !PRESENCE_ICON_SVG[legacyKey]) return undefined;
  return toModeSvg(PRESENCE_ICON_SVG[legacyKey]);
}

/** CSS var for composer / mode chrome — matches --agent-mode-* tokens in index.css. */
export function agentModeAccentCssVar(mode?: string | null): string {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'ask') return 'var(--agent-mode-ask)';
  if (m === 'plan') return 'var(--agent-mode-plan)';
  if (m === 'debug') return 'var(--agent-mode-debug)';
  if (m === 'multitask') return 'var(--agent-mode-multitask)';
  return 'var(--agent-mode-agent)';
}

export type AgentModePresenceIconProps = {
  mode?: AgentMode;
  state?: AgentPresenceState;
  iconKey?: ModePresenceIconKey;
  size?: number;
  title?: string;
  className?: string;
  motion?: boolean;
  tone?: 'mode' | 'classy' | 'ember' | 'mono' | 'mixed';
  'aria-label'?: string;
};

const ICON_SVG: Record<ModePresenceIconKey, string> = {
  'answer-forming': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><line class="stroke pulse" x1="24" y1="5" x2="24" y2="11"></line><line class="stroke pulse" x1="24" y1="37" x2="24" y2="43"></line><line class="stroke pulse" x1="5" y1="24" x2="11" y2="24"></line><line class="stroke pulse" x1="37" y1="24" x2="43" y2="24"></line><line class="stroke pulse" x1="11" y1="11" x2="15" y2="15"></line><line class="stroke pulse" x1="33" y1="33" x2="37" y2="37"></line><circle class="fill pulse" cx="24" cy="24" r="3"></circle></svg>`,

  'tool-route': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><circle class="fill pulse" cx="24" cy="24" r="4"></circle><line class="stroke route" x1="24" y1="24" x2="12" y2="13"></line><line class="stroke route" x1="24" y1="24" x2="36" y2="13"></line><line class="stroke route" x1="24" y1="24" x2="36" y2="35"></line><circle class="stroke pulse" cx="12" cy="13" r="4"></circle><circle class="stroke pulse" cx="36" cy="13" r="4"></circle><circle class="stroke pulse" cx="36" cy="35" r="4"></circle></svg>`,

  'execute-pulse': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><rect class="stroke pulse" x="10" y="13" width="28" height="22" rx="5"></rect><path class="stroke" d="M17 21l5 4-5 4"></path><line class="stroke blink" x1="26" y1="29" x2="33" y2="29"></line></svg>`,

  'patch-sweep': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><rect class="fill sweep" x="9" y="11" width="7" height="26" rx="2"></rect><rect class="fill sweep" x="20" y="16" width="7" height="16" rx="2"></rect><rect class="fill sweep" x="31" y="20" width="7" height="8" rx="2"></rect><line class="stroke" x1="8" y1="24" x2="40" y2="24"></line></svg>`,

  'verify-bloom': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><circle class="stroke pulse" cx="24" cy="24" r="15"></circle><path class="stroke draw" d="M16 25l6 6 12-15"></path></svg>`,

  'context-scan': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><rect class="stroke" x="9" y="12" width="30" height="24" rx="5"></rect><line class="stroke" x1="9" y1="19" x2="39" y2="19"></line><line class="stroke scanline" x1="14" y1="25" x2="34" y2="25"></line><circle class="fill pulse" cx="15" cy="16" r="1.5"></circle><circle class="fill pulse" cx="21" cy="16" r="1.5"></circle><circle class="fill pulse" cx="27" cy="16" r="1.5"></circle></svg>`,

  'source-thread': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><path class="stroke dash" d="M10 14c9 0 9 20 18 20s8-20 10-20"></path><circle class="fill float-a" cx="10" cy="14" r="3"></circle><circle class="fill float-b" cx="24" cy="24" r="3"></circle><circle class="fill float-c" cx="38" cy="14" r="3"></circle></svg>`,

  'clarify-gate': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><circle class="stroke dash spin" cx="24" cy="24" r="15"></circle><line class="stroke pulse" x1="20" y1="18" x2="20" y2="30"></line><line class="stroke pulse" x1="28" y1="18" x2="28" y2="30"></line></svg>`,

  'map-build': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><path class="stroke dash" d="M10 34V14l10 5 8-5 10 5v20l-10-5-8 5z"></path><line class="stroke pulse" x1="20" y1="19" x2="20" y2="39"></line><line class="stroke pulse" x1="28" y1="14" x2="28" y2="34"></line></svg>`,

  'task-stack': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><rect class="fill sweep" x="9" y="11" width="30" height="5" rx="2.5"></rect><rect class="fill sweep" x="9" y="21" width="24" height="5" rx="2.5"></rect><rect class="fill sweep" x="9" y="31" width="32" height="5" rx="2.5"></rect></svg>`,

  'risk-radar': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><circle class="stroke" cx="24" cy="24" r="15"></circle><circle class="stroke" cx="24" cy="24" r="8"></circle><line class="stroke spin" x1="24" y1="24" x2="36" y2="16"></line><circle class="fill pulse" cx="31" cy="18" r="2.5"></circle></svg>`,

  'handoff-ready': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><rect class="stroke float-a" x="8" y="15" width="12" height="18" rx="4"></rect><line class="stroke dash" x1="21" y1="24" x2="29" y2="24"></line><path class="stroke dash" d="M27 20l5 4-5 4"></path><rect class="stroke float-b" x="31" y="15" width="9" height="18" rx="4"></rect></svg>`,

  'trace-probe': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><circle class="stroke dash" cx="21" cy="21" r="10"></circle><line class="stroke pulse" x1="29" y1="29" x2="39" y2="39"></line><line class="stroke scanline" x1="14" y1="21" x2="28" y2="21"></line></svg>`,

  'fault-isolate': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><circle class="stroke pulse" cx="24" cy="24" r="15"></circle><circle class="stroke pulse" cx="24" cy="24" r="8"></circle><circle class="fill pulse" cx="24" cy="24" r="3"></circle></svg>`,

  'patch-hypothesis': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><rect class="fill sweep" x="9" y="11" width="7" height="26" rx="2"></rect><rect class="fill sweep" x="20" y="16" width="7" height="16" rx="2"></rect><rect class="fill sweep" x="31" y="20" width="7" height="8" rx="2"></rect><line class="stroke" x1="8" y1="24" x2="40" y2="24"></line></svg>`,

  'regression-check': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><path class="stroke pulse" d="M24 7l15 6v10c0 10-6 15-15 19C15 38 9 33 9 23V13z"></path><path class="stroke draw" d="M17 24l5 5 10-12"></path></svg>`,

  'subagent-swarm': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon swarm"><line class="stroke link" x1="24" y1="24" x2="13" y2="15"></line><line class="stroke link" x1="24" y1="24" x2="35" y2="15"></line><line class="stroke link" x1="24" y1="24" x2="10" y2="33"></line><line class="stroke link" x1="24" y1="24" x2="38" y2="33"></line><line class="stroke link" x1="24" y1="24" x2="24" y2="8"></line><rect class="node" x="21" y="21" width="6" height="6" rx="1.5"></rect><rect class="node" x="10" y="12" width="6" height="6" rx="1.5"></rect><rect class="node" x="32" y="12" width="6" height="6" rx="1.5"></rect><rect class="node" x="7" y="30" width="6" height="6" rx="1.5"></rect><rect class="node" x="35" y="30" width="6" height="6" rx="1.5"></rect><rect class="node" x="21" y="5" width="6" height="6" rx="1.5"></rect></svg>`,

  'delegate-chain': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><line class="stroke dash" x1="15" y1="24" x2="33" y2="24"></line><rect class="stroke float-a" x="6" y="16" width="12" height="16" rx="4"></rect><rect class="stroke float-b" x="18" y="16" width="12" height="16" rx="4"></rect><rect class="stroke float-c" x="30" y="16" width="12" height="16" rx="4"></rect></svg>`,

  'parallel-orbit': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><circle class="stroke spin" cx="24" cy="24" r="14"></circle><circle class="fill float-a" cx="24" cy="10" r="3"></circle><circle class="fill float-b" cx="38" cy="24" r="3"></circle><circle class="fill float-c" cx="24" cy="38" r="3"></circle><circle class="fill pulse" cx="24" cy="24" r="4"></circle></svg>`,

  'merge-weave': `<svg viewBox="0 0 48 48" class="iam-mode-presence-icon"><path class="stroke dash" d="M8 14c10 0 10 20 20 20s10-20 12-20"></path><path class="stroke dash" d="M8 34c10 0 10-20 20-20s10 20 12 20"></path><circle class="fill float-a" cx="8" cy="14" r="2.5"></circle><circle class="fill pulse" cx="24" cy="24" r="3"></circle><circle class="fill float-b" cx="40" cy="34" r="2.5"></circle></svg>`,
};

export function AgentModePresenceIcon({
  mode,
  state,
  iconKey,
  size = 54,
  title,
  className = '',
  motion = true,
  tone = 'mode',
  'aria-label': ariaLabel,
}: AgentModePresenceIconProps) {
  const resolvedKey = resolvePresenceIconKey({ mode, state, iconKey });
  const html = useMemo(
    () =>
      ICON_SVG[resolvedKey] ||
      legacyModeSvg(resolvedKey) ||
      legacyModeSvg('agent-spark') ||
      ICON_SVG['answer-forming'],
    [resolvedKey],
  );

  const color = (() => {
    if (tone === 'classy') return 'var(--presence-classy)';
    if (tone === 'ember') return 'var(--presence-ember)';
    if (tone === 'mono') return 'var(--presence-mono)';
    if (tone === 'mixed') return 'currentColor';
    // mode
    const m = String(mode || '').toLowerCase();
    return agentModeAccentCssVar(m);
  })();

  const decorative = ariaLabel == null || ariaLabel === '';
  return (
    <span
      className={`iam-mode-presence-slot ${className}${motion ? '' : ' motion-off'}`}
      style={{ width: size, height: size, color }}
      title={title}
      aria-hidden={decorative}
      aria-label={decorative ? undefined : ariaLabel}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

