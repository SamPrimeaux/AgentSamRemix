import { createKeepalive, encodeFrame } from '../../../backend/agentsam/sessions/do/live-stream.js';
import { isTerminalJobTerminal } from './state.js';

const REGISTRY = '_terminalJobSubscribers';

function registry(session) {
  if (!session[REGISTRY]) session[REGISTRY] = new Map();
  return session[REGISTRY];
}

function rowEvent(row) {
  let payload = {};
  try { payload = JSON.parse(String(row.payload || '{}')); } catch { payload = { raw: row.payload }; }
  return { seq: Number(row.seq), job_id: row.job_id, event_type: row.event_type, payload, created_at: row.created_at };
}

function frame(evt) {
  return `id: ${evt.seq}\nevent: terminal_job\ndata: ${JSON.stringify(evt)}\n\n`;
}


function deliver(sub, evt) {
  if (evt.seq <= sub.lastSeq) return false;
  sub.controller.enqueue(encodeFrame(frame(evt)));
  sub.lastSeq = evt.seq;
  if (isTerminalJobTerminal(evt.event_type)) {
    try { sub.controller.close(); } catch {}
    sub.cleanup?.();
  }
  return true;
}

export function publishTerminalJobEvent(session, jobId, eventType, payload = {}) {
  const id = String(jobId || '').trim();
  session.sql.exec(
    `INSERT INTO terminal_job_events (job_id, event_type, payload) VALUES (?, ?, ?)`,
    id, String(eventType), JSON.stringify(payload ?? {}),
  );
  const row = [...session.sql.exec(
    `SELECT seq, job_id, event_type, payload, created_at FROM terminal_job_events WHERE seq = last_insert_rowid() LIMIT 1`,
  )][0];
  if (!row) return null;
  const evt = rowEvent(row);
  const set = session[REGISTRY]?.get(id);
  if (set?.size) {
    for (const sub of [...set]) {
      try { deliver(sub, evt); } catch { sub.cleanup?.(); }
    }
  }
  return evt;
}

export function handleTerminalJobEventStream(session, url, jobId) {
  const id = String(jobId || '').trim();
  if (!id) return Response.json({ error: 'job_id_required' }, { status: 400 });
  const sinceSeq = Math.max(0, Number(url.searchParams.get('since_seq') || 0) || 0);
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const reg = registry(session);
      let set = reg.get(id);
      if (!set) { set = new Set(); reg.set(id, set); }
      const sub = { controller, lastSeq: sinceSeq, cleanup: () => cleanup() };
      set.add(sub);
      const stopKeepalive = createKeepalive(sub);
      const stopMax = setTimeout(() => {
        try { controller.close(); } catch {}
        cleanup();
      }, 30 * 60 * 1000);
      cleanup = () => {
        clearTimeout(stopMax);
        stopKeepalive();
        set.delete(sub);
        if (set.size === 0) reg.delete(id);
      };

      // Subscribe first, then replay. lastSeq de-duplicates an event that races
      // between subscription and the SQLite replay query.
      const rows = [...session.sql.exec(
        `SELECT seq, job_id, event_type, payload, created_at FROM terminal_job_events
         WHERE job_id = ? AND seq > ? ORDER BY seq ASC LIMIT 2000`, id, sinceSeq,
      )];
      for (const row of rows) {
        const evt = rowEvent(row);
        try { deliver(sub, evt); } catch { cleanup(); return; }
        if (isTerminalJobTerminal(evt.event_type)) return;
      }
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  }});
}
