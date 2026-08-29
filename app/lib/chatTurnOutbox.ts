/**
 * Per-tab resume cursor for Agent Sam turn_outbox (sessionStorage — not localStorage).
 * session_id is intentionally NOT a platform id; only since_seq per turn_id is stored here.
 */

import { CHAT_OUTBOX_CURSOR_SS_PREFIX } from '../src/lib/sessionStorageKeys';

export type TurnOutboxEvent = {
  seq: number;
  turn_id: string;
  event_type: 'token' | 'status' | 'done' | 'error' | string;
  payload: Record<string, unknown>;
  created_at?: number;
};

export type TurnOutboxReplay = {
  turn_id: string;
  since_seq: number;
  latest_seq: number;
  events: TurnOutboxEvent[];
};

export function readTurnOutboxCursor(turnId: string): number {
  const tid = String(turnId || '').trim();
  if (!tid || typeof sessionStorage === 'undefined') return 0;
  try {
    const raw = sessionStorage.getItem(`${CHAT_OUTBOX_CURSOR_SS_PREFIX}${tid}`);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeTurnOutboxCursor(turnId: string, sinceSeq: number): void {
  const tid = String(turnId || '').trim();
  if (!tid || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(`${CHAT_OUTBOX_CURSOR_SS_PREFIX}${tid}`, String(Math.max(0, Number(sinceSeq) || 0)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearTurnOutboxCursor(turnId: string): void {
  const tid = String(turnId || '').trim();
  if (!tid || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(`${CHAT_OUTBOX_CURSOR_SS_PREFIX}${tid}`);
  } catch {
    /* ignore */
  }
}

export async function fetchTurnOutboxReplay(
  conversationId: string,
  turnId: string,
  sinceSeq = 0,
): Promise<TurnOutboxReplay> {
  const convId = String(conversationId || '').trim();
  const tid = String(turnId || '').trim();
  if (!convId || !tid) {
    return { turn_id: tid, since_seq: sinceSeq, latest_seq: sinceSeq, events: [] };
  }

  const url =
    `/api/agent/sessions/${encodeURIComponent(convId)}/outbox` +
    `?turn_id=${encodeURIComponent(tid)}&since_seq=${encodeURIComponent(String(Math.max(0, sinceSeq)))}`;

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`turn_outbox_fetch_${res.status}`);
  }
  const data = (await res.json()) as TurnOutboxReplay;
  return {
    turn_id: String(data?.turn_id || tid),
    since_seq: Number(data?.since_seq) || sinceSeq,
    latest_seq: Number(data?.latest_seq) || sinceSeq,
    events: Array.isArray(data?.events) ? data.events : [],
  };
}

/** @returns true when replay included a terminal done/error event */
export function applyTurnOutboxEvents(
  events: TurnOutboxEvent[],
  onPayload: (payload: Record<string, unknown>) => void,
): { latestSeq: number; terminal: 'done' | 'error' | null } {
  let latestSeq = 0;
  let terminal: 'done' | 'error' | null = null;

  for (const evt of events) {
    if (evt?.seq != null && Number(evt.seq) > latestSeq) latestSeq = Number(evt.seq);
    if (evt?.turn_id) writeTurnOutboxCursor(evt.turn_id, latestSeq);

    const payload =
      evt?.payload && typeof evt.payload === 'object' ? evt.payload : { raw: evt?.payload };
    onPayload(payload);

    if (evt.event_type === 'done') terminal = 'done';
    if (evt.event_type === 'error') terminal = 'error';
  }

  return { latestSeq, terminal };
}
