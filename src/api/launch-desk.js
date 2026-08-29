import { getGlobalTraceProvider, run } from '@openai/agents';
import { launchDeskAgent, buildLaunchDeskInput } from '../launch-desk/agent.js';

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

function encodeSseEvent(encoder, event, payload = {}) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function readTextDelta(event) {
  if (!event || typeof event !== 'object') return '';
  const data = event.data;
  if (!data || typeof data !== 'object') return '';
  if (typeof data.delta === 'string') return data.delta;
  if (typeof data.text === 'string') return data.text;
  const nested = data.event;
  if (nested && typeof nested === 'object') {
    if (typeof nested.delta === 'string') return nested.delta;
    if (typeof nested.text === 'string') return nested.text;
  }
  return '';
}

function readToolName(event) {
  if (!event || typeof event !== 'object') return '';
  if (typeof event.name === 'string') return event.name;
  const item = event.item;
  if (item && typeof item === 'object') {
    if (typeof item.name === 'string') return item.name;
    if (typeof item.type === 'string') return item.type;
  }
  return '';
}

function isToolProgressEvent(event) {
  return event?.type === 'run_item_stream_event';
}

export async function handleLaunchDeskChat(request, env, ctx) {
  if (request.method === 'GET') {
    return jsonResponse({
      ok: true,
      route: '/api/launch-desk',
      model: 'gpt-5.5',
      supports_streaming: true,
    });
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const prompt = buildLaunchDeskInput({
    brief: body?.brief,
    audience: body?.audience,
    launchDate: body?.launchDate,
    constraints: body?.constraints,
    availableAssets: body?.availableAssets,
  });

  const responseStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (event, payload = {}) => {
        controller.enqueue(encodeSseEvent(encoder, event, payload));
      };

      let aborted = false;
      const signal = request.signal;
      const onAbort = () => {
        aborted = true;
        try {
          write('error', { message: 'Request aborted.' });
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        write('status', { type: 'started', model: 'gpt-5.5' });

        const result = await run(launchDeskAgent, prompt, {
          stream: true,
          context: {
            brief: body?.brief ?? '',
            audience: body?.audience ?? '',
            launchDate: body?.launchDate ?? '',
            constraints: body?.constraints ?? [],
            availableAssets: body?.availableAssets ?? [],
          },
          workflowName: 'Launch Desk',
        });

        let sawTool = false;
        let sawText = false;

        for await (const event of result) {
          if (aborted) break;

          if (event?.type === 'agent_updated_stream_event') {
            write('agent_update', { agent: event.agent?.name ?? 'Launch Desk Planner' });
            continue;
          }

          if (event?.type === 'raw_model_stream_event') {
            const delta = readTextDelta(event);
            if (delta) {
              sawText = true;
              write('text_delta', { delta });
            }
            continue;
          }

          if (isToolProgressEvent(event)) {
            sawTool = true;
            write('tool_progress', {
              name: readToolName(event),
              item_type: event.item?.type ?? null,
              status: event.item?.status ?? null,
              raw_name: event.name ?? null,
            });
          }
        }

        await result.completed;

        write('final_output', {
          text: result.finalOutput ?? '',
          sawTool,
          sawText,
        });
        write('done', { ok: true });
      } catch (error) {
        write('error', {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        try {
          signal?.removeEventListener?.('abort', onAbort);
        } catch {
          /* ignore */
        }
        try {
          if (ctx?.waitUntil) {
            ctx.waitUntil(getGlobalTraceProvider().forceFlush());
          }
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(responseStream, {
    status: 200,
    headers: sseHeaders(),
  });
}

export async function handleLaunchDeskHealth(request, env) {
  return jsonResponse({
    ok: true,
    api_key_configured: Boolean(process.env.OPENAI_API_KEY || env?.OPENAI_API_KEY),
  });
}
