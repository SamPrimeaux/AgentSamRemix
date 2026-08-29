import type { Message } from '../types';

export type ChatDiffEntry = {
  id: string;
  path: string;
  before: string;
  after: string;
  language?: string;
};

export function collectDiffArtifactsFromMessages(messages: Message[]): ChatDiffEntry[] {
  const out: ChatDiffEntry[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    for (const a of msg.previewArtifacts || []) {
      if (a.kind !== 'diff') continue;
      if (typeof a.before !== 'string' || typeof a.content !== 'string') continue;
      out.push({
        id: a.id,
        path: a.path || a.title || a.id,
        before: a.before,
        after: a.content,
        language: a.language,
      });
    }
  }
  return out;
}

export function computeDiffLineStats(
  before: string,
  after: string,
): { added: number; removed: number; isNew: boolean } {
  const bTrim = before.trim();
  const aTrim = after.trim();
  if (!bTrim && aTrim) {
    return { added: after.split('\n').length, removed: 0, isNew: true };
  }
  const bLines = before.split('\n');
  const aLines = after.split('\n');
  let added = 0;
  let removed = 0;
  const max = Math.max(bLines.length, aLines.length);
  for (let i = 0; i < max; i++) {
    const bl = bLines[i];
    const al = aLines[i];
    if (bl === undefined && al !== undefined) added++;
    else if (bl !== undefined && al === undefined) removed++;
    else if (bl !== al) {
      added++;
      removed++;
    }
  }
  return { added, removed, isNew: false };
}

export function shortPathLabel(path: string, max = 42): string {
  const p = String(path || '').trim().replace(/^\/+/, '');
  if (p.length <= max) return p;
  const parts = p.split('/');
  const file = parts.pop() || p;
  if (file.length >= max - 4) return `…${file.slice(-(max - 1))}`;
  return `…/${file}`;
}
