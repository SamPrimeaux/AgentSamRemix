/**
 * Session colorways from Agent Sam Loading States Lab (Classy / Ember / Mono).
 */

import type { CSSProperties } from 'react';

export type AgentPresenceColorway = 'cyan' | 'ember' | 'mono';

export const AGENT_PRESENCE_COLORWAYS: Record<
  AgentPresenceColorway,
  Record<'--accent' | '--accent-hover' | '--accent-muted' | '--accent-glow', string>
> = {
  cyan: {
    '--accent': '#5a7df7',
    '--accent-hover': '#7090f8',
    '--accent-muted': 'rgba(90,125,247,0.14)',
    '--accent-glow': 'rgba(90,125,247,0.26)',
  },
  ember: {
    '--accent': '#ff7a45',
    '--accent-hover': '#ff9a68',
    '--accent-muted': 'rgba(255,122,69,0.14)',
    '--accent-glow': 'rgba(255,122,69,0.30)',
  },
  mono: {
    '--accent': '#d8d8e0',
    '--accent-hover': '#ffffff',
    '--accent-muted': 'rgba(255,255,255,0.10)',
    '--accent-glow': 'rgba(255,255,255,0.20)',
  },
};

const COLORWAY_KEYS: AgentPresenceColorway[] = ['cyan', 'ember', 'mono'];

export function pickAgentPresenceColorway(): AgentPresenceColorway {
  return COLORWAY_KEYS[Math.floor(Math.random() * COLORWAY_KEYS.length)] ?? 'cyan';
}

export function agentPresenceColorwayStyle(
  colorway: AgentPresenceColorway,
): CSSProperties {
  return AGENT_PRESENCE_COLORWAYS[colorway] as CSSProperties;
}
