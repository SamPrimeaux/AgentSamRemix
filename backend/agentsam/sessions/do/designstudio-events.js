import { addSubscriber, createKeepalive, publishToTopic, encodeFrame } from './live-stream.js';

const REGISTRY = '_designStudioSubscribers';

function matchesRun(envelope, runId) {
  if (String(envelope?.payload?.workflow_run_id || '') === runId) return true;
  if (String(envelope?.workflow_run_id || '') === runId) return true;
  if (String(envelope?.type || '') === 'cad_glb_ready') {
    const evtRun = String(envelope?.agent_run_id || '').trim();
    return !evtRun || evtRun === runId;
  }
  return false;
}

function frame(id, jsonText) {
  return `id: ${id}\nevent: designstudio\ndata: ${jsonText}\n\n`;
}

export function appendDesignStudioEvent(session, envelope) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, error: 'envelope required' };
  const jsonText = JSON.stringify(envelope);
  session.sql.exec('INSERT INTO designstudio_event_outbox (envelope_json) VALUES (?)', jsonText);
  const row = [...session.sql.exec('SELECT last_insert_rowid() AS id')][0];
  const id = Number(row?.id) || 0;
  const reg = session[REGISTRY];
  if (reg?.size) {
    for (const runId of reg.keys()) {
      if (!matchesRun(envelope, runId)) continue;
      publishToTopic(session, REGISTRY, runId, frame(id, jsonText), {
        close: envelope?.event === 'supabase.sync.completed',
      });
    }
  }
  return { ok: true, id };
}

function replayRows(session, runId, lastId) {
  const raw = [...session.sql.exec(
    `SELECT id, envelope_json FROM designstudio_event_outbox WHERE id > ? ORDER BY id ASC LIMIT 1000`, lastId,
  )];
  return raw.filter((row) => {
    try { return matchesRun(JSON.parse(row.envelope_json), runId); }
    catch { return false; }
  });
}

export function handleDesignStudioEventStream(session, url) {
  const runId = (url.searchParams.get('run_id') || '').trim();
  if (!runId) return Response.json({ error: 'run_id required' }, { status: 400 });
  let lastId = parseInt(url.searchParams.get('last_id') || '0', 10);
  if (!Number.isFinite(lastId)) lastId = 0;
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const subscriber = { controller, cleanup: () => cleanup() };
      const remove = addSubscriber(session, REGISTRY, runId, subscriber);
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

      for (const row of replayRows(session, runId, lastId)) {
        const idNum = Number(row.id);
        try { controller.enqueue(encodeFrame(frame(idNum, row.envelope_json))); }
        catch { cleanup(); return; }
        lastId = idNum;
        try {
          const parsed = JSON.parse(row.envelope_json);
          if (parsed?.event === 'supabase.sync.completed') {
            controller.close();
            cleanup();
            return;
          }
        } catch {}
      }
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
