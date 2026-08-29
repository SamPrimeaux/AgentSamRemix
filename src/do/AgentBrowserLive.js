/**
 * AgentBrowserLiveV1 — thin Durable Object shell.
 * Live session authority + handlers live in backend/browser/do/*.
 */
import { DurableObject } from 'cloudflare:workers';
import { initializeBrowserSessionSchema } from '../../backend/browser/do/schema.js';
import { handleBrowserSessionFetch } from '../../backend/browser/do/router.js';
import { handleBrowserWebSocketMessage } from '../../backend/browser/do/websocket.js';
import { handleBrowserSessionAlarm } from '../../backend/browser/do/alarm.js';

export {
  LIVE_VIEW_URL_TTL_MS,
  LIVE_VIEW_REFRESH_MS,
  DEFAULT_AGENT_KEEP_ALIVE_MS,
} from '../../backend/browser/do/session.js';

export class AgentBrowserLiveV1 extends DurableObject {
  /**
   * @param {import('@cloudflare/workers-types').DurableObjectState} state
   * @param {Record<string, unknown>} env
   */
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
    /** @type {import('@cloudflare/workers-types').SqlStorage} */
    this.sql = state.storage.sql;
    /** @type {(() => void)|null} */
    this._hitlResolve = null;
    /** @type {((err: Error) => void)|null} */
    this._hitlReject = null;

    state.blockConcurrencyWhile(async () => {
      initializeBrowserSessionSchema(this.sql);
    });
  }

  /** @param {Request} request */
  fetch(request) {
    return handleBrowserSessionFetch(this, request);
  }

  /**
   * @param {import('@cloudflare/workers-types').WebSocket} ws
   * @param {string|ArrayBuffer} message
   */
  webSocketMessage(ws, message) {
    return handleBrowserWebSocketMessage(this, ws, message);
  }

  alarm() {
    return handleBrowserSessionAlarm(this);
  }
}
