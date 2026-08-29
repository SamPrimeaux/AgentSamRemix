/** 
 * Realtime broadcast room for workflow step events + CMS live-edit presence.
 * Handles WebSocket clients and POST /broadcast from Worker.
 * CMS rooms: cms:{pageId} — presence_join / heartbeat / presence_leave.
 */
import { DurableObject } from "cloudflare:workers";
import { buildActiveThemeApiPayload } from "../../backend/services/cms/theme/active.js";
import { getAuthUser } from "../core/auth.js";
import {
  leaveCmsLiveEditSession,
  touchCmsLiveEditSession,
} from "../core/cms-live-edit-session.js";

export class IAMCollaborationSession extends DurableObject {
  /**
   * @param {import('@cloudflare/workers-types').DurableObjectState} state
   * @param {Record<string, unknown>} env
   */
  constructor(state, env) {
    super(state, env);
    /** @type {import('@cloudflare/workers-types').DurableObjectState} */
    this._state = state;
    this.env = env;
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (pathname.startsWith("/api/collab/canvas")) {
      pathname = pathname.replace(/^\/api\/collab\/canvas/, "/canvas");
    }

    // POST /broadcast — send raw text to all connected sockets
    if (request.method === 'POST' && (pathname === '/broadcast' || pathname.endsWith('/broadcast'))) {
      const text = await request.text();
      const sockets = this.ctx.getWebSockets();
      let delivered = 0;
      for (const ws of sockets) {
        try { ws.send(text); delivered++; } catch (e) {
          console.warn('[IAM_COLLAB] broadcast send', e?.message ?? e);
        }
      }
      return new Response(JSON.stringify({ ok: true, delivered, queued: delivered === 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /canvas/state — return persisted canvas elements + active theme
    if (request.method === 'GET' && pathname === '/canvas/state') {
      const elements = (await this.ctx.storage.get('canvas_elements')) ?? [];
      const activeTheme = (await this.ctx.storage.get('canvas_active_theme')) ?? null;
      return new Response(JSON.stringify({ canvasElements: elements, activeTheme }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /canvas/elements — persist elements + broadcast canvas_update
    if (request.method === 'POST' && pathname === '/canvas/elements') {
      const { elements } = await request.json();
      await this.ctx.storage.put('canvas_elements', elements);
      const msg = JSON.stringify({ type: 'canvas_update', elements });
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(msg); } catch (_) {}
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // POST /canvas/theme — legacy path: validate slug in D1, broadcast only (D1 prefs own persistence).
    if (request.method === 'POST' && pathname === '/canvas/theme') {
      const { theme_slug } = await request.json();
      const row = await this.env.DB.prepare(
        'SELECT * FROM cms_themes WHERE slug = ?'
      ).bind(theme_slug).first();
      if (!row) return new Response(JSON.stringify({ error: 'unknown theme_slug' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      const payload = buildActiveThemeApiPayload(row);
      if (!payload?.slug || !payload.data) {
        return new Response(JSON.stringify({ error: 'theme_payload' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      const msg = JSON.stringify({
        type: 'theme_update',
        theme_slug: payload.slug,
        cssVars: payload.data,
        monaco_theme: payload.monaco_theme,
        monaco_bg: payload.monaco_bg,
        monaco_theme_data: payload.monaco_theme_data,
      });
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(msg); } catch (_) {}
      }
      return new Response(JSON.stringify({ ok: true, theme_slug: payload.slug }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Non-WebSocket requests fall through here (info endpoint)
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(JSON.stringify({ do: 'IAMCollaborationSession', ok: true, room: pathname }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const authUser = await getAuthUser(request, this.env).catch(() => null);
    const roomMatch = url.pathname.match(/\/api\/collab\/room\/(.+)$/i);
    let roomName = '';
    try {
      roomName = roomMatch ? decodeURIComponent(roomMatch[1]) : '';
    } catch {
      roomName = roomMatch ? roomMatch[1] : '';
    }
    const attachment = {
      userId: authUser?.id ? String(authUser.id) : null,
      tenantId: authUser?.tenant_id ? String(authUser.tenant_id) : null,
      room: roomName,
      pageId: roomName.startsWith('cms:') ? roomName.slice(4) : null,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async #broadcastPresence(room) {
    const peers = [];
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const att = ws.deserializeAttachment() || {};
        if (att?.userId) peers.push({ user_id: att.userId, page_id: att.pageId || null });
      } catch (_) {}
    }
    const msg = JSON.stringify({ type: 'presence_state', peers });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch (_) {}
    }
    if (room?.startsWith('cms:')) {
      await this.ctx.storage.put(`presence:${room}`, { peers, updated_at: Date.now() });
    }
  }

  /** @param {WebSocket} ws @param {string | ArrayBuffer} message */
  async webSocketMessage(ws, message) {
    try {
      if (typeof message === 'string' && message === 'ping') {
        ws.send('pong');
        return;
      }
      if (typeof message !== 'string') return;
      let msg;
      try {
        msg = JSON.parse(message);
      } catch {
        return;
      }
      const att = ws.deserializeAttachment() || {};
      const userId = att.userId ? String(att.userId) : null;
      const pageId =
        att.pageId ||
        (msg?.page_id != null ? String(msg.page_id) : null) ||
        (att.room?.startsWith('cms:') ? att.room.slice(4) : null);

      if (msg.type === 'presence_join' && userId && pageId) {
        await touchCmsLiveEditSession(this.env, { pageId, userId });
        await this.#broadcastPresence(att.room || `cms:${pageId}`);
        return;
      }
      if (msg.type === 'heartbeat' && userId && pageId) {
        await touchCmsLiveEditSession(this.env, { pageId, userId });
        ws.send(JSON.stringify({ type: 'heartbeat_ack', page_id: pageId }));
        return;
      }
      if (msg.type === 'presence_leave' && userId && pageId) {
        await leaveCmsLiveEditSession(this.env, { pageId, userId });
        await this.#broadcastPresence(att.room || `cms:${pageId}`);
      }
    } catch (_) {}
  }

  /** @param {WebSocket} ws */
  async webSocketClose(ws) {
    try {
      const att = ws.deserializeAttachment() || {};
      const userId = att.userId ? String(att.userId) : null;
      const pageId = att.pageId ? String(att.pageId) : null;
      if (userId && pageId) {
        await leaveCmsLiveEditSession(this.env, { pageId, userId });
        await this.#broadcastPresence(att.room || `cms:${pageId}`);
      }
      ws.close(1000, 'done');
    } catch (_) {}
  }
}
