import type { ChatComposerSource } from './types';
import { COMPOSER_SOURCES_KEY_PREFIX } from '../../../src/lib/sessionStorageKeys';

export function composerSourcesStorageKey(
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
): string {
  const u = userId?.trim() || 'anon';
  const w = workspaceId?.trim() || 'nows';
  return `${COMPOSER_SOURCES_KEY_PREFIX}:${u}:${w}`;
}

export function readComposerSources(key: string): ChatComposerSource[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is ChatComposerSource =>
        s &&
        typeof s === 'object' &&
        typeof (s as ChatComposerSource).id === 'string' &&
        typeof (s as ChatComposerSource).label === 'string' &&
        ['mcp', 'oauth', 'web_search'].includes(String((s as ChatComposerSource).kind)),
    );
  } catch {
    return [];
  }
}

export function writeComposerSources(key: string, sources: ChatComposerSource[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(sources.slice(0, 12)));
  } catch {
    /* ignore quota */
  }
}
