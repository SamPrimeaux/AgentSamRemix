/** Local-time day segment — aligned with greeting strings. */
export type AgentDayPart = 'late-night' | 'morning' | 'afternoon' | 'evening';

export function dayPartFromHour(hour: number): AgentDayPart {
  if (hour < 5) return 'late-night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function scenePresetForDayPart(part: AgentDayPart): string {
  switch (part) {
    case 'late-night':
      return 'night';
    case 'evening':
      return 'dusk';
    case 'morning':
      return 'dawn';
    case 'afternoon':
      return 'day';
    default:
      return 'night';
  }
}

export function greetingForDayPart(part: AgentDayPart, name: string): string {
  switch (part) {
    case 'late-night':
      return `Late night, ${name}`;
    case 'morning':
      return `Morning, ${name}`;
    case 'afternoon':
      return `Afternoon, ${name}`;
    case 'evening':
      return `Evening, ${name}`;
    default:
      return `Hello, ${name}`;
  }
}

export function greetingNameFromDisplay(displayName?: string | null): string {
  const raw = String(displayName || '').trim();
  if (!raw) return 'there';
  const first = raw.split(/\s+/)[0];
  return first || raw;
}
