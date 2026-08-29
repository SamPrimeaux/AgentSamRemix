/** OpenAI Realtime voice options — SSOT for composer picker (Agent Sam Voice lane). */

import { VOICE_PREFS_STORAGE_KEY } from '../../../src/lib/sessionStorageKeys';

export { VOICE_PREFS_STORAGE_KEY };

export type RealtimeVoiceId =
  | 'alloy'
  | 'ash'
  | 'ballad'
  | 'coral'
  | 'echo'
  | 'sage'
  | 'shimmer'
  | 'verse'
  | 'marin';

export type VoicePersonaId = 'operator' | 'concise' | 'friendly';

export const REALTIME_VOICE_OPTIONS: Array<{
  id: RealtimeVoiceId;
  label: string;
  blurb: string;
}> = [
  { id: 'alloy', label: 'Alloy', blurb: 'Neutral default' },
  { id: 'ash', label: 'Ash', blurb: 'Clear and steady' },
  { id: 'ballad', label: 'Ballad', blurb: 'Warm narrative' },
  { id: 'coral', label: 'Coral', blurb: 'Bright and open' },
  { id: 'echo', label: 'Echo', blurb: 'Soft and even' },
  { id: 'sage', label: 'Sage', blurb: 'Calm advisory' },
  { id: 'shimmer', label: 'Shimmer', blurb: 'Light and quick' },
  { id: 'verse', label: 'Verse', blurb: 'Expressive' },
  { id: 'marin', label: 'Marin', blurb: 'Natural GA default' },
];

export const VOICE_PERSONAS: Array<{
  id: VoicePersonaId;
  label: string;
  blurb: string;
  instructions: string;
}> = [
  {
    id: 'operator',
    label: 'Operator',
    blurb: 'Platform desk — concise, action-oriented',
    instructions:
      'You are Agent Sam, the Inner Animal Media platform operator. Keep spoken replies short and actionable. Prefer confirming what you will do before calling tools. Meet/video is a separate product — this is voice only.',
  },
  {
    id: 'concise',
    label: 'Concise',
    blurb: 'Minimal words, high signal',
    instructions:
      'You are Agent Sam. Answer in one or two short spoken sentences unless the user asks for detail. Use tools only when needed. Skip filler.',
  },
  {
    id: 'friendly',
    label: 'Friendly',
    blurb: 'Warm, still competent',
    instructions:
      'You are Agent Sam — helpful and personable, but still a platform operator. Keep spoken replies conversational and clear. Use tools when they improve the answer.',
  },
];

/** Read-only tools safe for voice auto-execute (no deploy/terminal/writes). */
export const VOICE_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    name: 'agentsam_memory_search',
    description: 'Search Agent Sam private/platform memory for relevant facts.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function' as const,
    name: 'agentsam_codebase_retrieve',
    description: 'Semantic code search over the indexed IAM / workspace codebase.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to find in code' },
        limit: { type: 'number', description: 'Max hits (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function' as const,
    name: 'search_web',
    description: 'Search the public web for up-to-date information.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Web search query' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function' as const,
    name: 'agentsam_search_tools',
    description: 'Discover which IAM tools exist and when to use them.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Capability or tool name to search' },
      },
      required: ['query'],
    },
  },
];

export type VoicePrefs = {
  voiceId: RealtimeVoiceId;
  personaId: VoicePersonaId;
};

export function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(VOICE_PREFS_STORAGE_KEY);
    if (!raw) return { voiceId: 'alloy', personaId: 'operator' };
    const parsed = JSON.parse(raw) as Partial<VoicePrefs>;
    const voiceId = REALTIME_VOICE_OPTIONS.some((v) => v.id === parsed.voiceId)
      ? (parsed.voiceId as RealtimeVoiceId)
      : 'alloy';
    const personaId = VOICE_PERSONAS.some((p) => p.id === parsed.personaId)
      ? (parsed.personaId as VoicePersonaId)
      : 'operator';
    return { voiceId, personaId };
  } catch {
    return { voiceId: 'alloy', personaId: 'operator' };
  }
}

export function saveVoicePrefs(prefs: VoicePrefs): void {
  try {
    localStorage.setItem(VOICE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

export function personaInstructions(personaId: VoicePersonaId): string {
  return VOICE_PERSONAS.find((p) => p.id === personaId)?.instructions ?? VOICE_PERSONAS[0].instructions;
}
