/**
 * MeauxChess invite emails + join URLs (Resend).
 */
import { sendResendEmail } from '../../backend/services/email/resend.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function gamesPublicBaseUrl(env, request = null) {
  const fromEnv =
    (env?.PUBLIC_APP_URL && String(env.PUBLIC_APP_URL).trim()) ||
    (env?.APP_URL && String(env.APP_URL).trim()) ||
    '';
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (request) {
    try {
      const url = new URL(request.url);
      return `${url.protocol}//${url.host}`;
    } catch {
      /* fall through */
    }
  }
  return 'https://inneranimalmedia.com';
}

export function chessRoomUrl(env, roomId, request = null) {
  return `${gamesPublicBaseUrl(env, request)}/games/${encodeURIComponent(String(roomId))}`;
}

export function isValidInviteEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || e.length > 254) return false;
  return EMAIL_RE.test(e);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inviteHtml({ inviterLabel, link }) {
  const safeInviter = escapeHtml(inviterLabel);
  const safeLink = escapeHtml(link);
  return `
    <div style="font-family:Inter,system-ui,sans-serif;background:#0a0a0f;color:#eef2ff;padding:36px;border-radius:16px;max-width:520px;border:1px solid rgba(255,255,255,0.08)">
      <div style="color:#00ffcc;font-weight:800;font-size:12px;letter-spacing:0.28em;text-transform:uppercase;margin-bottom:12px">MeauxChess</div>
      <h2 style="color:#fff;margin:0 0 12px;font-size:22px">You're invited to play</h2>
      <p style="color:#8b95a8;line-height:1.55;margin:0 0 20px"><strong style="color:#eef2ff">${safeInviter}</strong> invited you to a live 3D chess match on Inner Animal Media.</p>
      <a href="${safeLink}" style="display:inline-block;background:linear-gradient(135deg,#00ffcc,#00c9a7);color:#051018;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700">Join the game</a>
      <p style="color:#6b7280;font-size:12px;margin-top:18px;line-height:1.5">Or copy this link:<br><span style="color:#8b95a8">${safeLink}</span></p>
    </div>
  `;
}

export async function sendChessRoomInvite(env, opts) {
  const email = String(opts.email || '').trim().toLowerCase();
  if (!isValidInviteEmail(email)) return { error: 'Invalid email address' };
  const roomId = String(opts.roomId || '').trim();
  if (!roomId) return { error: 'Missing room id' };

  const inviterLabel = String(opts.inviterName || opts.invitedBy || 'A friend').trim() || 'A friend';
  const link = chessRoomUrl(env, roomId, opts.request);
  const subject = `${inviterLabel} invited you to MeauxChess`;
  const html = inviteHtml({ inviterLabel, link });
  const text = `${inviterLabel} invited you to a MeauxChess game.\n\nJoin: ${link}`;

  const result = await sendResendEmail(env, {
    to: email,
    subject,
    html,
    text,
    tags: [{ name: 'source', value: 'meauxchess_invite' }],
  });

  if (result.error) return { error: result.error };
  return { ok: true, resendId: result.id, link };
}
