import { DurableObject } from "cloudflare:workers";

export class ChessRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sessions = new Map(); // socketId → { socket, color, playerId, displayName }
    this.gameId = null;
    this.roomId = null;
    this.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; // standard start
    this.currentTurn = 'white';
    this.moveCount = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.roomId = this.roomId ?? url.pathname.split('/').pop();

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      const socketId = crypto.randomUUID();
      server._socketId = socketId;

      // Assign color
      const takenColors = new Set([...this.sessions.values()].map(s => s.color));
      const color = !takenColors.has('white') ? 'white' : !takenColors.has('black') ? 'black' : 'spectator';

      this.sessions.set(socketId, {
        socket: server,
        color,
        playerId: null,
        displayName: 'Player',
      });

      // If 2 players now connected → create game row in D1
      const activePlayers = [...this.sessions.values()].filter(s => s.color !== 'spectator');
      if (activePlayers.length === 2 && !this.gameId) {
        const gameId = `game_${crypto.randomUUID().replace(/-/g,'').slice(0,12)}`;
        this.gameId = gameId;
        const white = activePlayers.find(s => s.color === 'white');
        const black = activePlayers.find(s => s.color === 'black');
        if (white && black) {
          await this.env.DB.prepare(`
            INSERT INTO games (id, room_id, white_player_id, black_player_id, status, board_state, started_at)
            VALUES (?, ?, ?, ?, 'active', ?, datetime('now'))
          `).bind(gameId, this.roomId, white.playerId ?? 'guest_w', black.playerId ?? 'guest_b', this.fen).run()
            .catch(e => console.warn('[ChessRoom] game insert', e?.message));
        }
      }

      this.broadcast({ type: 'state', fen: this.fen, turn: this.currentTurn, color, gameId: this.gameId });

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response(JSON.stringify({ do: 'ChessRoom', roomId: this.roomId, ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(message); } catch { return; }
    const socketId = ws._socketId;
    const session = this.sessions.get(socketId);
    if (!session) return;

    if (msg.type === 'join') {
      session.playerId = msg.playerId ?? session.playerId;
      session.displayName = msg.displayName ?? session.displayName;
      ws.send(JSON.stringify({ type: 'joined', color: session.color, fen: this.fen, turn: this.currentTurn }));
    }

    if (msg.type === 'move') {
      // Validate turn
      if (session.color !== this.currentTurn) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not your turn' }));
        return;
      }
      // Accept move — update state
      if (msg.fen) this.fen = msg.fen;
      this.currentTurn = this.currentTurn === 'white' ? 'black' : 'white';
      this.moveCount++;

      // Fire-and-forget D1 writes
      if (this.gameId) {
        this.env.DB.prepare(`
          INSERT INTO game_moves (game_id, move_number, player_id, color, from_square, to_square, piece, fen_after)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(this.gameId, this.moveCount, session.playerId ?? 'guest', session.color,
            msg.from ?? '', msg.to ?? '', msg.piece ?? '', this.fen)
          .run().catch(e => console.warn('[ChessRoom] move insert', e?.message));

        this.env.DB.prepare(`
          UPDATE games SET board_state = ?, current_turn = ?, move_count = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(this.fen, this.currentTurn, this.moveCount, this.gameId)
          .run().catch(e => console.warn('[ChessRoom] game update', e?.message));
      }

      this.broadcast({ type: 'move', fen: this.fen, turn: this.currentTurn, from: msg.from, to: msg.to, piece: msg.piece, color: session.color });
    }

    if (msg.type === 'resign' || msg.type === 'draw_accept') {
      const winner = msg.type === 'resign' ? (session.color === 'white' ? 'black' : 'white') : 'draw';
      if (this.gameId) {
        await this.env.DB.prepare(`
          UPDATE games SET status='completed', winner=?, result_reason=?, ended_at=datetime('now') WHERE id=?
        `).bind(winner, msg.type, this.gameId).run()
          .catch(e => console.warn('[ChessRoom] resign update', e?.message));
      }
      this.broadcast({ type: 'game_over', winner, reason: msg.type });
    }

    if (msg.type === 'sync') {
      ws.send(JSON.stringify({ type: 'state', fen: this.fen, turn: this.currentTurn, moveCount: this.moveCount, gameId: this.gameId }));
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  async webSocketClose(ws) {
    const socketId = ws._socketId;
    this.sessions.delete(socketId);
    this.broadcast({ type: 'player_left' });
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const { socket } of this.sessions.values()) {
      try { socket.send(msg); } catch {}
    }
  }
}
