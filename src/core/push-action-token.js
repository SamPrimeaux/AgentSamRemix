/**
 * Signed push-action tokens — SW notification buttons POST /api/push/action
 * without a browser session. Instruction is sealed in the HMAC payload.
 */

const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;

function b64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecodeToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacHex(signingKey, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function signingSecret(env) {
  return (
    (env?.TOKEN_SIGNING_KEY && String(env.TOKEN_SIGNING_KEY).trim()) ||
    (env?.AGENTSAM_BRIDGE_KEY && String(env.AGENTSAM_BRIDGE_KEY).trim()) ||
    ''
  );
}

/**
 * @param {any} env
 * @param {{
 *   conversationId: string,
 *   action: string,
 *   instruction: string,
 *   ttlSec?: number,
 * }} opts
 * @returns {Promise<string|null>}
 */
export async function mintPushActionToken(env, opts) {
  const secret = signingSecret(env);
  if (!secret) return null;
  const conversationId = String(opts.conversationId || '').trim();
  const action = String(opts.action || '').trim().slice(0, 32);
  const instruction = String(opts.instruction || '').trim().slice(0, 4000);
  if (!conversationId || !action || !instruction) return null;

  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Number(opts.ttlSec) || DEFAULT_TTL_SEC);
  const body = {
    v: 1,
    cid: conversationId,
    action,
    instruction,
    exp,
  };
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(body)));
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

/**
 * @param {any} env
 * @param {string} token
 * @returns {Promise<{ ok: true, conversationId: string, action: string, instruction: string } | { ok: false, error: string }>}
 */
export async function verifyPushActionToken(env, token) {
  const secret = signingSecret(env);
  if (!secret) return { ok: false, error: 'signing_key_missing' };
  const raw = String(token || '').trim();
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return { ok: false, error: 'malformed_token' };
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/i.test(sig)) return { ok: false, error: 'malformed_sig' };

  const expected = await hmacHex(secret, payload);
  if (expected.length !== sig.length) return { ok: false, error: 'bad_sig' };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, error: 'bad_sig' };

  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(payload)));
  } catch {
    return { ok: false, error: 'bad_payload' };
  }
  if (!body || body.v !== 1) return { ok: false, error: 'bad_version' };
  const exp = Number(body.exp) || 0;
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, error: 'expired' };

  const conversationId = String(body.cid || '').trim();
  const action = String(body.action || '').trim();
  const instruction = String(body.instruction || '').trim();
  if (!conversationId || !action || !instruction) return { ok: false, error: 'incomplete' };

  return { ok: true, conversationId, action, instruction };
}

/**
 * Build signed Web Notification actions for a conversation thread.
 * Max 2 actions (Chrome Android / most PWAs).
 *
 * @param {any} env
 * @param {string} conversationId
 * @param {{ continueInstruction?: string, statusInstruction?: string } | null} [custom]
 */
export async function buildPhoneLoopPushActions(env, conversationId, custom = null) {
  const cid = String(conversationId || '').trim();
  if (!cid) return { actions: [], actionTokens: {} };

  const continueInstruction =
    (custom?.continueInstruction && String(custom.continueInstruction).trim()) ||
    'Continue the work on this Agent Sam thread. Pick up from the last result and proceed with the next logical steps.';
  const statusInstruction =
    (custom?.statusInstruction && String(custom.statusInstruction).trim()) ||
    'Give me a short status update on this conversation — what finished, what is blocked, and what you recommend next.';

  const continueTok = await mintPushActionToken(env, {
    conversationId: cid,
    action: 'continue',
    instruction: continueInstruction,
  });
  const statusTok = await mintPushActionToken(env, {
    conversationId: cid,
    action: 'status',
    instruction: statusInstruction,
  });

  const actions = [];
  const actionTokens = {};
  if (continueTok) {
    actions.push({ action: 'continue', title: 'Continue' });
    actionTokens.continue = continueTok;
  }
  if (statusTok) {
    actions.push({ action: 'status', title: 'Status' });
    actionTokens.status = statusTok;
  }
  return { actions, actionTokens };
}
