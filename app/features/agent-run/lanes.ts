import type { AgentToolLane } from './types';
import type { ModePresenceIconKey } from '../mode-presence/agentModePresenceMap';

export const toolLaneIconMap: Record<AgentToolLane, ModePresenceIconKey> = {
  default: 'agent-spark',
  inspect: 'context-scan',
  terminal: 'execute-pulse',
  diff: 'patch-sweep',
  image: 'pixel',
  video: 'pixel',
  diagram: 'path',
  files: 'files',
  browser: 'browser',
  database: 'context-scan',
  workflow: 'work-queue',
  subagent: 'subagent-swarm',
  skeleton: 'skeleton-plan',
};

const LANE_LABELS: Record<AgentToolLane, string> = {
  default: 'Working',
  inspect: 'Inspecting context',
  terminal: 'Running command',
  diff: 'Editing files',
  image: 'Generating image',
  video: 'Rendering video',
  diagram: 'Drawing structure',
  files: 'Managing files',
  browser: 'Reading browser context',
  database: 'Working with database',
  workflow: 'Running workflow',
  subagent: 'Coordinating subagents',
  skeleton: 'Loading preview',
};

export function laneLabel(lane: AgentToolLane): string {
  return LANE_LABELS[lane] ?? LANE_LABELS.default;
}

/** Map catalog / SSE tool names to a lane icon family. */
export function toolNameToLane(toolName?: string | null): AgentToolLane {
  const t = String(toolName || '').toLowerCase();
  if (!t) return 'default';
  if (/terminal|wrangler|bash|shell|pty|npm run|python/.test(t)) return 'terminal';
  if (/browser|playwright|navigate|screenshot/.test(t)) return 'browser';
  if (/d1_|d1_query|d1_write|sql|migration|supabase|hyperdrive/.test(t)) return 'database';
  if (/image|thumbnail|flux|replicate|draw|pixel/.test(t)) return 'image';
  if (/video|movie|remotion|render/.test(t)) return 'video';
  if (/excalidraw|diagram|canvas|draw/.test(t)) return 'diagram';
  if (/r2_|upload|file|monaco|patch|edit|github.*file|write/.test(t)) return 'diff';
  if (/workflow|subagent|delegate|fanout/.test(t)) return 'workflow';
  if (/grep|read|search|scan|vector|memory|rag/.test(t)) return 'inspect';
  if (/deploy|ship/.test(t)) return 'terminal';
  return 'default';
}
