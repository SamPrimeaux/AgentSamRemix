// src/api/games.js
import { jsonResponse } from '../core/responses.js';
import { resolveCronWorkspaceId } from '../../backend/jobs/cron-tenant.js';
import { buildChessPieceRegistry } from '../core/chess-piece-registry.js';
import { sendChessRoomInvite, isValidInviteEmail } from '../core/games-shared.js';

export async function handleGamesApi(request, url, env, _ctx, authUser) {
  const path = url.pathname.toLowerCase();
  const method = request.method;

  // GET /api/games/pieces — Design Studio cms_assets + v1 side-specific GLBs
  if (path === '/api/games/pieces' && method === 'GET') {
    const registry = await buildChessPieceRegistry(env.DB);
    return jsonResponse(registry);
  }

  // POST /api/games/rooms — create a room (guest-safe)
  if (path === '/api/games/rooms' && method === 'POST') {
    const roomId = `room_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    let wsId = String(authUser?.active_workspace_id ?? authUser?.workspace_id ?? authUser?.workspaceId ?? '').trim();
    if (!wsId) {
      wsId = (await resolveCronWorkspaceId(env)) || '';
      if (!wsId) {
        return jsonResponse({ error: 'workspace_required' }, 400);
      }
    }
    const hostId = authUser?.id ?? `guest_${crypto.randomUUID().slice(0, 8)}`;
    const hostName = authUser?.name ?? 'Guest';
    await env.DB.prepare(`
      INSERT INTO game_rooms (id, game_type, status, host_player_id, host_display_name, workspace_id)
      VALUES (?, 'chess', 'open', ?, ?, ?)
    `).bind(roomId, hostId, hostName, wsId).run();
    return jsonResponse({ roomId });
  }

  // POST /api/games/rooms/:roomId/invite — email join link via Resend
  if (path.match(/^\/api\/games\/rooms\/room_[a-z0-9]+\/invite$/) && method === 'POST') {
    const roomId = path.split('/')[4];
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const email = String(body.email || '').trim();
    if (!isValidInviteEmail(email)) return jsonResponse({ error: 'Valid email required' }, 400);
    const room = await env.DB.prepare(`SELECT id FROM game_rooms WHERE id = ?`).bind(roomId).first();
    if (!room) return jsonResponse({ error: 'Room not found' }, 404);
    const inviterName = String(body.inviterName || authUser?.name || 'A friend').trim() || 'A friend';
    const result = await sendChessRoomInvite(env, {
      email,
      roomId,
      inviterName,
      invitedBy: authUser?.id ?? 'guest',
      request,
    });
    if (result.error) return jsonResponse({ error: result.error }, 502);
    return jsonResponse({ ok: true, link: result.link, resendId: result.resendId });
  }

  // GET /api/games/rooms/:roomId
  if (path.match(/^\/api\/games\/rooms\/room_[a-z0-9]+$/) && method === 'GET') {
    const roomId = path.split('/').pop();
    const room = await env.DB.prepare(`SELECT * FROM game_rooms WHERE id = ?`).bind(roomId).first();
    if (!room) return jsonResponse({ error: 'Room not found' }, 404);
    const game = room.current_game_id
      ? await env.DB.prepare(`SELECT * FROM games WHERE id = ?`).bind(room.current_game_id).first()
      : null;
    return jsonResponse({ room, game });
  }

  // GET /api/games/:gameId/moves
  if (path.match(/^\/api\/games\/[^/]+\/moves$/) && method === 'GET') {
    const gameId = path.split('/')[3];
    const { results } = await env.DB.prepare(`
      SELECT * FROM game_moves WHERE game_id = ? ORDER BY move_number ASC
    `).bind(gameId).all();
    return jsonResponse({ results });
  }

  // GET /api/games/ws/:roomId — WebSocket upgrade to ChessRoom DO
  if (path.startsWith('/api/games/ws/')) {
    const roomId = path.split('/').pop();
    const doId = env.CHESS_SESSION.idFromName(roomId);
    const stub = env.CHESS_SESSION.get(doId);
    return stub.fetch(request);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
