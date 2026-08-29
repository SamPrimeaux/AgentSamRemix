import { addSubscriber, createKeepalive, publishToTopic, encodeFrame } from './live-stream.js';

const REGISTRY = '_turnOutboxSubscribers';

/** Drop outbox rows older than 24h. INTEGER unixepoch only. */
export const TURN_OUTBOX_TTL_SEC = 86_400;

/**
 * @param {import('@cloudflare/workers-types').SqlStorage} sql
 * @returns {{ deleted: number }}
 */
export function pruneTurnOutbox(sql) {
  if (!sql?.exec) return { deleted: 0 };
  const cutoff = Math.floor(Date.now() / 1000) - TURN_OUTBOX_TTL_SEC;
  try {
    const result = sql.exec(`DELETE FROM turn_outbox WHERE created_at < ?`, cutoff);
    const deleted = Number(result?.rowsWritten ?? result?.changes ?? 0) || 0;
    if (deleted > 0) {
      console.info('[turn_outbox] pruned', JSON.stringify({ deleted, cutoff }));
    }
    return { deleted };
  } catch (e) {
    console.warn('[turn_outbox] prune failed', e?.message ?? e);
    return { deleted: 0 };
  }
}

function rowToEvent(r) {
  let payload = {};
  try { payload = r.payload ? JSON.parse(r.payload) : {}; }
  catch { payload = { raw: r.payload }; }
  return { seq: Number(r.seq), turn_id: r.turn_id, event_type: r.event_type, payload, created_at: r.created_at };
}

function frameForEvent(evt) {
  return `id: ${evt.seq}\nevent: chat_outbox\ndata: ${JSON.stringify(evt)}\n\n`;
}

export async function handlePostOutbox(session, request) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const turnId = String(body?.turn_id || '').trim();
  if (!turnId) return Response.json({ ok: false, error: 'missing_turn_id' }, { status: 400 });
  let events = [];
  if (Array.isArray(body?.events) && body.events.length) {
    events = body.events.map((evt) => ({ event_type: String(evt?.event_type || '').trim(), payload: evt?.payload ?? {} })).filter((evt) => evt.event_type);
  } else {
    const eventType = String(body?.event_type || '').trim();
    if (!eventType) return Response.json({ ok: false, error: 'missing_turn_id_or_event_type' }, { status: 400 });
    events = [{ event_type: eventType, payload: body?.payload ?? {} }];
  }
  let latestSeq = null;
  for (const evt of events) {
    session.sql.exec(`INSERT INTO turn_outbox (turn_id, event_type, payload) VALUES (?, ?, ?)`, turnId, evt.event_type, JSON.stringify(evt.payload ?? {}));
    const row = [...session.sql.exec(`SELECT seq, turn_id, event_type, payload, created_at FROM turn_outbox WHERE seq = last_insert_rowid() LIMIT 1`)][0];
    if (!row) continue;
    const data = rowToEvent(row);
    latestSeq = data.seq;
    publishToTopic(session, REGISTRY, turnId, frameForEvent(data), {
      close: data.event_type === 'done' || data.event_type === 'error',
    });
  }
  return Response.json({ ok: true, seq: latestSeq, latest_seq: latestSeq, turn_id: turnId, count: events.length });
}

export async function handleGetOutbox(session, url) {
  const turnId = (url.searchParams.get('turn_id') || '').trim();
  if (!turnId) return Response.json({ error: 'turn_id required' }, { status: 400 });
  const sinceSeq = Math.max(0, Number(url.searchParams.get('since_seq') || 0) || 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 500, 1), 1000);
  const rows = [...session.sql.exec(
    `SELECT seq, turn_id, event_type, payload, created_at FROM turn_outbox
     WHERE turn_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`, turnId, sinceSeq, limit,
  )];
  const events = rows.map(rowToEvent);
  const latestSeq = events.length ? events[events.length - 1].seq : sinceSeq;
  return Response.json({ turn_id: turnId, since_seq: sinceSeq, latest_seq: latestSeq, events });
}

export function handleTurnOutboxStream(session, url) {
  const turnId = (url.searchParams.get('turn_id') || '').trim();
  if (!turnId) return Response.json({ error: 'turn_id required' }, { status: 400 });
  const sinceSeq = Math.max(0, Number(url.searchParams.get('since_seq') || 0) || 0);
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const subscriber = { controller, cleanup: () => cleanup() };
      const remove = addSubscriber(session, REGISTRY, turnId, subscriber);
      const stopKeepalive = createKeepalive(subscriber);
      const stopMax = setTimeout(() => {
        try { controller.close(); } catch {}
        cleanup();
      }, 10 * 60 * 1000);
      cleanup = () => {
        clearTimeout(stopMax);
        stopKeepalive();
        remove();
      };

      const replay = [...session.sql.exec(
        `SELECT seq, turn_id, event_type, payload, created_at FROM turn_outbox
         WHERE turn_id = ? AND seq > ? ORDER BY seq ASC LIMIT 1000`, turnId, sinceSeq,
      )];
      for (const row of replay) {
        const evt = rowToEvent(row);
        try { controller.enqueue(encodeFrame(frameForEvent(evt))); } catch { cleanup(); return; }
        if (evt.event_type === 'done' || evt.event_type === 'error') {
          try { controller.close(); } catch {}
          cleanup();
          return;
        }
      }
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    },
  });
}
