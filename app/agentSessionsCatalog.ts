import type { AgentSessionSummary } from '@inneranimalmedia/client-core';

export type AgentSessionRow = AgentSessionSummary & {
  name_key?: string;
  session_type?: string;
  message_count?: number;
  has_artifacts?: boolean;
  artifact_count?: number;
  active_file?: string | null;
  files_open?: string | null;
  is_starred?: boolean;
  last_turn_status?: string | null;
  total_tokens_out?: number | null;
};

/** Placeholder titles that must not mask a real minted session title. */
export function isPlaceholderAgentChatTitle(title: string | null | undefined): boolean {
  const t = String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return !t || t === 'chat' || t === 'new chat' || t === 'agent chat';
}

/**
 * Mirror of `deriveChatSessionTitle` (Worker) — optimistic header/tab naming on first send.
 */
export function deriveAgentChatTitleFromMessage(message: string): string {
  const STOP = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'are', 'was',
    'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'i', 'you', 'he', 'she', 'it', 'we',
    'they', 'my', 'your', 'me', 'us', 'them', 'this', 'that', 'these', 'those', 'please', 'hey', 'hi',
  ]);
  const raw = String(message || '').trim();
  if (!raw) return 'New Chat';
  const cleaned = raw.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(Boolean);
  if (!words.length) return 'New Chat';
  const meaningful = words.filter((w) => !STOP.has(w.toLowerCase()));
  const pool = meaningful.length >= 3 ? meaningful : words;
  const capped = pool.slice(0, 8).map((w) => {
    const lower = w.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
  let selected = [...capped];
  while (selected.length > 1 && selected.join(' ').length > 40) selected.pop();
  let title = selected.join(' ');
  if (title.length > 40) title = title.slice(0, 40).trim();
  return title || 'New Chat';
}

export function sessionDisplayTitle(s: AgentSessionRow): string {
  const title = s.title && String(s.title).replace(/\s+/g, ' ').trim();
  if (title && !isPlaceholderAgentChatTitle(title)) return title;
  const name = s.name && String(s.name).replace(/\s+/g, ' ').trim();
  if (name && !isPlaceholderAgentChatTitle(name)) return name;
  const id = (s.conversation_id || s.id || '').trim();
  if (id) return `Chat ${id.slice(0, 8)}`;
  return 'New chat';
}

export function sessionStartedAtMs(s: AgentSessionRow): number {
  const st = s.started_at;
  if (typeof st !== 'number' || !Number.isFinite(st) || st <= 0) return 0;
  // Canonical contract is integer epoch seconds; tolerate ms if a stale client slips through.
  return st < 1e12 ? st * 1000 : st;
}

/** Sort key for chat lists — prefers updated_at, falls back to started_at. */
export function sessionSortMs(s: AgentSessionRow): number {
  const u = s.updated_at;
  if (typeof u === 'number' && Number.isFinite(u) && u > 0) {
    return u < 1e12 ? u * 1000 : u;
  }
  return sessionStartedAtMs(s);
}

export function conversationIdFromSession(s: AgentSessionRow): string {
  return String(s.conversation_id || s.id || '').trim();
}

/** Optimistic sidebar row when the client mints a conversation before D1 catches up. */
export function buildOptimisticAgentSessionRow(input: {
  conversationId: string;
  title: string;
  workspaceId?: string | null;
}): AgentSessionRow {
  const id = String(input.conversationId || '').trim();
  const title = String(input.title || 'New Chat').trim() || 'New Chat';
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    conversation_id: id,
    title,
    name: title,
    workspace_id: input.workspaceId != null ? String(input.workspaceId).trim() || null : null,
    message_count: 1,
    started_at: now,
    updated_at: now,
    is_starred: false,
    status: 'active',
    session_type: 'chat',
  };
}

export function prependOptimisticAgentSession(
  prev: AgentSessionRow[],
  row: AgentSessionRow,
): AgentSessionRow[] {
  const id = conversationIdFromSession(row);
  if (!id) return prev;
  const rest = prev.filter((s) => conversationIdFromSession(s) !== id);
  return [row, ...rest];
}

/** Human-readable timestamp for /dashboard/chats rows (Claude-style). */
export function chatsListRelativeTime(s: AgentSessionRow): string {
  const t = sessionSortMs(s);
  if (!t) return '';
  const diffMs = Math.max(0, Date.now() - t);
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function relativeSessionTime(s: AgentSessionRow): string {
  const t = sessionStartedAtMs(s);
  if (!t) return '';
  const diffMs = Math.max(0, Date.now() - t);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  const y = Math.floor(d / 365);
  return `${y}y`;
}

function startOfTodayLocal(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeekMondayLocal(): number {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonthLocal(): number {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function sessionGroupLabel(ts: number): 'Today' | 'This Week' | 'This Month' | 'Older' {
  if (!ts) return 'Older';
  const startToday = startOfTodayLocal();
  if (ts >= startToday) return 'Today';
  const startWeek = startOfWeekMondayLocal();
  if (ts >= startWeek) return 'This Week';
  const startMonth = startOfMonthLocal();
  if (ts >= startMonth) return 'This Month';
  return 'Older';
}

export function groupSessionsByBucket(rows: AgentSessionRow[]): { label: string; items: AgentSessionRow[] }[] {
  const withTs = rows.map((r) => ({ row: r, ts: sessionStartedAtMs(r) }));
  withTs.sort((a, b) => b.ts - a.ts);
  const buckets: Record<'Today' | 'This Week' | 'This Month' | 'Older', AgentSessionRow[]> = {
    Today: [],
    'This Week': [],
    'This Month': [],
    Older: [],
  };
  for (const { row, ts } of withTs) {
    buckets[sessionGroupLabel(ts)].push(row);
  }
  const order: ('Today' | 'This Week' | 'This Month' | 'Older')[] = [
    'Today',
    'This Week',
    'This Month',
    'Older',
  ];
  return order.filter((l) => buckets[l].length > 0).map((label) => ({ label, items: buckets[label] }));
}
