/**
 * Canonical chess GLB URLs — Baroque set on R2 custom domain assets.inneranimalmedia.com
 * R2 keys: glb/chess/baroque/*.glb → https://assets.inneranimalmedia.com/glb/chess/baroque/*
 */
export const CHESS_ASSETS_ORIGIN = 'https://assets.inneranimalmedia.com';
export const CHESS_BAROQUE_R2_PREFIX = 'glb/chess/baroque';

export const CHESS_BAROQUE_BASE = `${CHESS_ASSETS_ORIGIN}/${CHESS_BAROQUE_R2_PREFIX}`;

export const CHESS_BOARD_URL = `${CHESS_BAROQUE_BASE}/baroque_board_opt.glb`;

export const CHESS_BAROQUE_PIECES = {
  king: {
    white: `${CHESS_BAROQUE_BASE}/baroque_king_white_opt.glb`,
    black: `${CHESS_BAROQUE_BASE}/baroque_king_black_opt.glb`,
  },
  queen: {
    white: `${CHESS_BAROQUE_BASE}/baroque_queen_white_opt.glb`,
    black: `${CHESS_BAROQUE_BASE}/baroque_queen_black_opt.glb`,
  },
  bishop: {
    white: `${CHESS_BAROQUE_BASE}/baroque_bishop_white_opt.glb`,
    black: `${CHESS_BAROQUE_BASE}/baroque_bishop_black_opt.glb`,
  },
  knight: {
    white: `${CHESS_BAROQUE_BASE}/baroque_knight_white_opt.glb`,
    black: `${CHESS_BAROQUE_BASE}/baroque_knight_black_opt.glb`,
  },
  rook: {
    white: `${CHESS_BAROQUE_BASE}/baroque_rook_white_opt.glb`,
    black: `${CHESS_BAROQUE_BASE}/baroque_rook_black_opt.glb`,
  },
  pawn: {
    white: `${CHESS_BAROQUE_BASE}/baroque_pawn_white_opt.glb`,
    black: `${CHESS_BAROQUE_BASE}/baroque_pawn_black_opt.glb`,
  },
} as const;

export type ChessPieceType = keyof typeof CHESS_BAROQUE_PIECES;

/** @deprecated Use CHESS_BAROQUE_PIECES — kept for imports that expect white-only map */
export const CHESS_PIECES_BASE = CHESS_BAROQUE_BASE;

export const CHESS_PIECE_URLS = {
  king: CHESS_BAROQUE_PIECES.king.white,
  queen: CHESS_BAROQUE_PIECES.queen.white,
  bishop: CHESS_BAROQUE_PIECES.bishop.white,
  knight: CHESS_BAROQUE_PIECES.knight.white,
  rook: CHESS_BAROQUE_PIECES.rook.white,
  pawn: CHESS_BAROQUE_PIECES.pawn.white,
} as const;

/** Curated runtime astronaut rig — 5 clips, meshopt (~4.69 MB). R2 is canonical in prod. */
export const ASTRONAUT_GLB_BASE = '/assets/glb/astronaut';

export const ASTRONAUT_RUNTIME_GLB = `${ASTRONAUT_GLB_BASE}/astronaut_rig_animations_opt.glb`;

export const ASTRONAUT_ANIMATION_CLIPS = ['walking', 'running', 'boxing', 'climb_fall', 'fall'] as const;

export type AstronautAnimationClip = (typeof ASTRONAUT_ANIMATION_CLIPS)[number];

export function chessPieceGlbPath(color: 'white' | 'black', piece: string): string {
  const p = String(piece || 'pawn')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '') as ChessPieceType;
  const key = p in CHESS_BAROQUE_PIECES ? p : 'pawn';
  return CHESS_BAROQUE_PIECES[key][color];
}

/** @deprecated Use chessPieceGlbPath — alias kept for ChessViewport imports. */
export function chessOptimizedPieceUrl(piece: string): string {
  return chessPieceGlbPath('white', piece);
}

/** Non-chess GLB URL normalization only — never rewrite chess piece URLs. */
export function normalizeGlbUrl(input: string | null | undefined): string {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (s.startsWith('/assets/')) return s;

  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://inneranimalmedia.com';
    const u = new URL(s, base);

    // Dedicated CAD bucket is public + CDN-fronted — load cross-origin as-is, never flatten.
    if (u.hostname === 'cad.inneranimalmedia.com') return s;

    if (u.hostname.includes('inneranimalmedia.com') && u.pathname.startsWith('/assets/')) {
      return u.pathname;
    }

    if (u.hostname.includes('assets.inneranimalmedia.com')) {
      const p = u.pathname.replace(/^\/+/, '');
      if (p.startsWith('chess-pieces/')) {
        return `/assets/glb/chess/${p.replace(/^chess-pieces\//, '')}`;
      }
      if (p.startsWith('glb/')) return `/assets/${p}`;
      if (p.startsWith('assets/')) return `/assets/${p}`;
      if (p) return `/assets/glb/${p}`;
    }

    if (u.hostname.includes('pub-e733f82cb31c4f34b6a719e749d0416d.r2.dev')) {
      const tail = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
      if (tail) return `/assets/glb/${tail}`;
    }
  } catch {
    /* keep raw */
  }

  return s;
}

export function normalizeChessPieceUrls<T extends { type?: string; white_url?: string; black_url?: string }>(
  row: T,
): T {
  return {
    ...row,
    white_url: row.white_url ? normalizeGlbUrl(row.white_url) : row.white_url,
    black_url: row.black_url ? normalizeGlbUrl(row.black_url) : row.black_url,
  };
}
