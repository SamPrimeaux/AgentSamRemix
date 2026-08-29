/** Algebraic square ↔ board coords (8×8 centered at ±3.5). */
import { getBoardSurfaceY, rankToZ, zToRank } from './chessBoard';

const FILES = 'abcdefgh';

export function squareToPosition(square: string): { x: number; y: number; z: number } | null {
  const s = String(square || '').trim().toLowerCase();
  if (s.length !== 2) return null;
  const file = FILES.indexOf(s[0]);
  const rank = parseInt(s[1], 10);
  if (file < 0 || rank < 1 || rank > 8) return null;
  return { x: file - 3.5, y: getBoardSurfaceY(), z: rankToZ(rank) };
}

export function positionToSquare(x: number, z: number): string | null {
  const file = Math.round(x + 3.5);
  const rank = zToRank(z);
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return `${FILES[file]}${rank}`;
}

const FEN_PIECE_NAMES: Record<string, { color: 'white' | 'black'; piece: string }> = {
  p: { color: 'black', piece: 'pawn' },
  r: { color: 'black', piece: 'rook' },
  n: { color: 'black', piece: 'knight' },
  b: { color: 'black', piece: 'bishop' },
  q: { color: 'black', piece: 'queen' },
  k: { color: 'black', piece: 'king' },
  P: { color: 'white', piece: 'pawn' },
  R: { color: 'white', piece: 'rook' },
  N: { color: 'white', piece: 'knight' },
  B: { color: 'white', piece: 'bishop' },
  Q: { color: 'white', piece: 'queen' },
  K: { color: 'white', piece: 'king' },
};

export type FenPiecePlacement = {
  square: string;
  color: 'white' | 'black';
  piece: string;
  fenChar: string;
};

/** Piece placement rows only (first FEN field). Rank 8 → index 0. */
export function parseFenPlacement(fen: string): FenPiecePlacement[] {
  const placement = String(fen || '').trim().split(/\s+/)[0] || '';
  const ranks = placement.split('/');
  const out: FenPiecePlacement[] = [];
  for (let rankIdx = 0; rankIdx < ranks.length; rankIdx++) {
    let fileIdx = 0;
    for (const ch of ranks[rankIdx]) {
      if (/\d/.test(ch)) {
        fileIdx += parseInt(ch, 10);
        continue;
      }
      const meta = FEN_PIECE_NAMES[ch];
      if (!meta || fileIdx > 7) continue;
      const square = `${FILES[fileIdx]}${8 - rankIdx}`;
      out.push({ square, ...meta, fenChar: ch });
      fileIdx += 1;
    }
  }
  return out;
}
