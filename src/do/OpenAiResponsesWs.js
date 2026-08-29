/**
 * OpenAiResponsesWsV1 — Durable Object holding an outbound WebSocket to
 * wss://api.openai.com/v1/responses (Responses API WebSocket mode).
 *
 * Worker isolate lifetime ≠ 60min socket lifetime; this DO is the connection holder.
 * One in-flight response.create at a time (OpenAI: no multiplexing).
 */
import { DurableObject } from 'cloudflare:workers';

const OPENAI_RESPONSES_HTTP = 'https://api.openai.com/v1/responses';
const MAX_CONNECT_MS = 15_000;
const MAX_TURN_MS = 120_000;
const MAX_SOCKET_AGE_MS = 55 * 60 * 1000;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

export class OpenAiResponsesWsV1 extends DurableObject {
  /** @type {WebSocket|null} */
  #ws = null;
  /** @type {string|null} */
  #apiKey = null;
  /** @type {string|null} */
  #safetyId = null;
  #connectedAt = 0;
  /** @type {((ev: MessageEvent) => void)|null} */
  #messageHandler = null;
  /** @type {((ev: CloseEvent|Event) => void)|null} */
  #closeHandler = null;

  /**
   * @param {{ apiKey: string, safetyIdentifier?: string|null }} opts
   */
  async ensureConnected(opts) {
    const apiKey = trim(opts?.apiKey);
    if (!apiKey) throw new Error('openai_ws_api_key_required');
    const safetyId = trim(opts?.safetyIdentifier) || null;

    if (this.#ws && this.#ws.readyState === WebSocket.OPEN && this.#apiKey === apiKey) {
      const ageMs = this.#connectedAt ? Date.now() - this.#connectedAt : Number.POSITIVE_INFINITY;
      if (ageMs < MAX_SOCKET_AGE_MS) {
        return { ok: true, reused: true, connected_at: this.#connectedAt, age_ms: ageMs };
      }
      console.info('[openai_responses_ws_do] proactive_socket_rotation', { age_ms: ageMs });
    }

    await this.#teardown();

    const headers = {
      Upgrade: 'websocket',
      Authorization: `Bearer ${apiKey}`,
    };
    if (safetyId) headers['OpenAI-Safety-Identifier'] = safetyId;

    const connectAbort = AbortSignal.timeout(MAX_CONNECT_MS);
    const resp = await fetch(OPENAI_RESPONSES_HTTP, {
      headers,
      signal: connectAbort,
    });
    const ws = resp.webSocket;
    if (!ws) {
      const body = await resp.text().catch(() => '');
      throw new Error(
        `openai_ws_upgrade_failed status=${resp.status} body=${String(body).slice(0, 300)}`,
      );
    }
    ws.accept();
    this.#ws = ws;
    this.#apiKey = apiKey;
    this.#safetyId = safetyId;
    this.#connectedAt = Date.now();

    this.#closeHandler = () => {
      this.#ws = null;
      this.#connectedAt = 0;
    };
    ws.addEventListener('close', this.#closeHandler);
    ws.addEventListener('error', this.#closeHandler);

    return { ok: true, reused: false, connected_at: this.#connectedAt };
  }

  async status() {
    return {
      ok: true,
      connected: !!(this.#ws && this.#ws.readyState === WebSocket.OPEN),
      connected_at: this.#connectedAt || null,
      has_safety_id: !!this.#safetyId,
    };
  }

  async close() {
    await this.#teardown();
    return { ok: true };
  }

  /**
   * Send response.create and return a ReadableStream of OpenAI-compatible SSE bytes
   * (data: {json}\\n\\n) until response.completed / response.failed / error / timeout.
   *
   * @param {{
   *   apiKey: string,
   *   safetyIdentifier?: string|null,
   *   create: Record<string, unknown>,
   * }} opts
   * @returns {Promise<ReadableStream<Uint8Array>>}
   */
  async createResponseSse(opts) {
    await this.ensureConnected({
      apiKey: opts.apiKey,
      safetyIdentifier: opts.safetyIdentifier,
    });
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('openai_ws_not_connected');
    }

    const create = opts.create && typeof opts.create === 'object' ? { ...opts.create } : {};
    delete create.stream;
    delete create.background;
    const payload = { type: 'response.create', ...create };

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    let closed = false;
    const turnStarted = Date.now();
    let turnTimer = null;
    let turnCloseHandler = null;
    let turnErrorHandler = null;

    const finish = async () => {
      if (closed) return;
      closed = true;
      if (this.#messageHandler && this.#ws) {
        this.#ws.removeEventListener('message', this.#messageHandler);
      }
      this.#messageHandler = null;
      if (turnCloseHandler) {
        try {
          ws.removeEventListener('close', turnCloseHandler);
        } catch {
          /* already detached */
        }
      }
      if (turnErrorHandler) {
        try {
          ws.removeEventListener('error', turnErrorHandler);
        } catch {
          /* already detached */
        }
      }
      if (turnTimer) clearTimeout(turnTimer);
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    };

    const fail = async (err) => {
      if (closed) return;
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'error',
              error: { message: msg, code: 'openai_ws_turn_failed' },
            })}\n\n`,
          ),
        );
      } catch {
        /* ignore */
      }
      await finish();
    };

    turnCloseHandler = () => void fail(new Error('openai_ws_closed_mid_turn'));
    turnErrorHandler = () => void fail(new Error('openai_ws_error_mid_turn'));
    ws.addEventListener('close', turnCloseHandler);
    ws.addEventListener('error', turnErrorHandler);
    turnTimer = setTimeout(() => void fail(new Error('openai_ws_turn_timeout')), MAX_TURN_MS);

    this.#messageHandler = (event) => {
      void (async () => {
        if (closed) return;
        if (Date.now() - turnStarted > MAX_TURN_MS) {
          await fail(new Error('openai_ws_turn_timeout'));
          return;
        }
        let raw = '';
        try {
          raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        } catch {
          return;
        }
        let obj = null;
        try {
          obj = JSON.parse(raw);
        } catch {
          return;
        }
        try {
          await writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          await finish();
          return;
        }

        const t = String(obj?.type || '');
        if (
          t === 'response.completed' ||
          t === 'response.failed' ||
          t === 'response.incomplete' ||
          (t === 'error' && obj?.error?.code === 'previous_response_not_found') ||
          (t === 'error' && obj?.error?.code === 'websocket_connection_limit_reached')
        ) {
          if (obj?.error?.code === 'websocket_connection_limit_reached') {
            await this.#teardown();
          }
          await finish();
        }
      })();
    };
    ws.addEventListener('message', this.#messageHandler);

    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      await fail(e);
    }

    return readable;
  }

  async #teardown() {
    if (this.#messageHandler && this.#ws) {
      try {
        this.#ws.removeEventListener('message', this.#messageHandler);
      } catch {
        /* ignore */
      }
    }
    this.#messageHandler = null;
    if (this.#closeHandler && this.#ws) {
      try {
        this.#ws.removeEventListener('close', this.#closeHandler);
        this.#ws.removeEventListener('error', this.#closeHandler);
      } catch {
        /* ignore */
      }
    }
    this.#closeHandler = null;
    if (this.#ws) {
      try {
        this.#ws.close(1000, 'teardown');
      } catch {
        /* ignore */
      }
    }
    this.#ws = null;
    this.#apiKey = null;
    this.#safetyId = null;
    this.#connectedAt = 0;
  }
}
