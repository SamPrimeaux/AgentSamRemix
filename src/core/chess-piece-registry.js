/**
 * Build chess piece URL registry from cms_assets (Baroque set + legacy fallbacks).
 */
import { normalizeGlbPublicUrl } from './glb-public-url.js';

export const CHESS_ASSETS_ORIGIN = 'https://assets.inneranimalmedia.com';

export const CHESS_PIECE_TYPES = ['king', 'queen', 'bishop', 'knight', 'rook', 'pawn'];

/** @typedef {{ white_url: string, black_url: string, shared_mesh: boolean }} PieceUrls */

/**
 * @param {Record<string, unknown>} row
 * @returns {{ piece: string, side: 'white' | 'black' } | null}
 */
function parsePieceSideFromRow(row) {
  const r2Key = String(row.r2_key || row.path || '');
  if (r2Key.includes('/chess/v1/') || r2Key.includes('chess/v1/')) return null;

  let metadata = {};
  try {
    metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {};
  } catch {
    metadata = {};
  }

  const pieceType = String(metadata.piece_type || metadata.piece || '').trim().toLowerCase();
  const sideMeta = String(metadata.side || '').trim().toLowerCase();
  if (pieceType === 'board') return null;
  if (pieceType && (sideMeta === 'white' || sideMeta === 'black')) {
    return { piece: pieceType, side: sideMeta };
  }

  const id = String(row.id || '');
  const dsBlack = id.match(/^ds_stock_chess_(\w+)_black$/i);
  if (dsBlack) return { piece: dsBlack[1].toLowerCase(), side: 'black' };

  const dsWhite = id.match(/^ds_stock_chess_(king|queen|bishop|knight|rook|pawn)$/i);
  if (dsWhite) return { piece: dsWhite[1].toLowerCase(), side: 'white' };

  const filename = String(row.filename || row.original_filename || '');
  const baroqueMatch = filename.match(/baroque_(\w+)_(white|black)(?:_opt)?\.glb/i);
  if (baroqueMatch) return { piece: baroqueMatch[1].toLowerCase(), side: baroqueMatch[2].toLowerCase() };

  const optMatch = filename.match(/chess_(\w+)_(white|black)(?:_opt)?\.glb/i);
  if (optMatch) return { piece: optMatch[1].toLowerCase(), side: optMatch[2].toLowerCase() };

  return null;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
function isBoardRow(row) {
  let metadata = {};
  try {
    metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {};
  } catch {
    metadata = {};
  }
  const pieceType = String(metadata.piece_type || '').trim().toLowerCase();
  if (pieceType === 'board') return true;
  const filename = String(row.filename || row.original_filename || '').toLowerCase();
  return filename.includes('baroque_board') || filename.includes('chess_board');
}

/**
 * @param {Record<string, PieceUrls>} registry
 * @param {string} piece
 * @param {'white' | 'black'} side
 * @param {string} url
 */
function assignUrl(registry, piece, side, url) {
  if (!CHESS_PIECE_TYPES.includes(piece) || !url) return;
  if (!registry[piece]) {
    registry[piece] = { white_url: '', black_url: '', shared_mesh: false };
  }
  const key = side === 'white' ? 'white_url' : 'black_url';
  registry[piece][key] = url;
}

/**
 * Prefer r2_key for same-origin Worker passthrough; fall back to normalized public_url.
 * @param {Record<string, unknown>} row
 */
function rowToUrl(row) {
  const r2Key = String(row.r2_key || '').trim();
  if (r2Key && !r2Key.includes('chess/v1/')) {
    const key = r2Key.replace(/^\/+/, '');
    if (key.startsWith('glb/chess/baroque/')) {
      return `${CHESS_ASSETS_ORIGIN}/${key}`;
    }
    return `/assets/${key}`;
  }
  return normalizeGlbPublicUrl(row.public_url);
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @returns {Promise<{ preserve_materials: boolean, source: string, board_url: string | null, pieces: Record<string, PieceUrls> }>}
 */
export async function buildChessPieceRegistry(db) {
  const { results } = await db
    .prepare(
      `
      SELECT id, filename, original_filename, public_url, metadata, tags, r2_key, path, category
      FROM cms_assets
      WHERE is_live = 1
        AND (
          category IN ('chess', '3d_studio')
          AND (tags LIKE '%chess%' OR id LIKE 'ds_stock_chess_%')
        )
      ORDER BY id
    `,
    )
    .all();

  /** @type {Record<string, PieceUrls>} */
  const pieces = {};
  for (const piece of CHESS_PIECE_TYPES) {
    pieces[piece] = { white_url: '', black_url: '', shared_mesh: false };
  }

  let cmsCount = 0;
  let boardUrl = null;

  for (const row of results || []) {
    if (isBoardRow(row)) {
      const url = rowToUrl(row);
      if (url && !url.includes('/chess/v1/')) boardUrl = url;
      continue;
    }

    const parsed = parsePieceSideFromRow(row);
    if (!parsed) continue;
    const url = rowToUrl(row);
    if (!url || url.includes('/chess/v1/')) continue;
    assignUrl(pieces, parsed.piece, parsed.side, url);
    cmsCount += 1;
  }

  for (const piece of CHESS_PIECE_TYPES) {
    if (!pieces[piece].black_url && pieces[piece].white_url) {
      pieces[piece].black_url = pieces[piece].white_url;
    }
    pieces[piece].shared_mesh = Boolean(
      pieces[piece].white_url && pieces[piece].white_url === pieces[piece].black_url,
    );
  }

  const source = cmsCount > 0 ? 'cms_assets' : 'none';

  return {
    preserve_materials: cmsCount > 0,
    board_url: boardUrl,
    source,
    pieces,
  };
}
