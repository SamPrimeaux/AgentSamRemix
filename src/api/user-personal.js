/**
 * Per-user notes pad + contacts — /api/user/notes/* and /api/user/contacts/*
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function resolveWorkspaceId(authUser, env) {
  const fromSession = authUser?.workspace_id ?? authUser?.workspaceId ?? null;
  if (fromSession && String(fromSession).trim()) return String(fromSession).trim();
  const fromEnv = env?.WORKSPACE_ID ?? null;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return null;
}

async function resolveUserId(env, authUser) {
  return (await resolveIntegrationUserId(env, authUser)) || String(authUser?.id || '').trim();
}

function normalizeNoteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '',
    body: row.body || '',
    color: row.color || null,
    pinned: row.pinned === 1 || row.pinned === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeContactRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    display_name: row.display_name || '',
    username: row.username || null,
    email: row.email || null,
    phone: row.phone || null,
    avatar_url: row.avatar_url || null,
    description: row.description || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function handleNotesApi(request, url, env, authUser, userId, workspaceId, parts, method) {
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  if (parts.length === 0 && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, title, body, color, pinned, created_at, updated_at
       FROM user_notes
       WHERE user_id = ?
       ORDER BY pinned DESC, updated_at DESC
       LIMIT 200`,
    )
      .bind(userId)
      .all()
      .catch(() => ({ results: [] }));
    return jsonResponse({ ok: true, notes: (results || []).map(normalizeNoteRow).filter(Boolean) }, 200);
  }

  if (parts.length === 0 && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const noteBody = String(body?.body ?? body?.content ?? '').trim();
    const titleRaw = body?.title != null ? String(body.title).trim() : '';
    const title = titleRaw || (noteBody ? noteBody.split('\n')[0].slice(0, 120) : 'Untitled note');
    if (!noteBody && !titleRaw) {
      return jsonResponse({ error: 'title or body required' }, 400);
    }
    const id = newId('unote');
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await env.DB.prepare(
      `INSERT INTO user_notes (id, user_id, workspace_id, title, body, color, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        userId,
        workspaceId,
        title.slice(0, 200),
        noteBody.slice(0, 20000),
        body?.color != null ? String(body.color).slice(0, 32) : null,
        body?.pinned === true || body?.pinned === 1 ? 1 : 0,
        now,
        now,
      )
      .run();
    const row = await env.DB.prepare(
      `SELECT id, title, body, color, pinned, created_at, updated_at FROM user_notes WHERE id = ? AND user_id = ?`,
    )
      .bind(id, userId)
      .first();
    return jsonResponse({ ok: true, note: normalizeNoteRow(row) }, 201);
  }

  const noteId = parts[0] ? String(parts[0]).trim() : '';
  if (!noteId) return jsonResponse({ error: 'Not found' }, 404);

  if (parts.length === 1 && method === 'GET') {
    const row = await env.DB.prepare(
      `SELECT id, title, body, color, pinned, created_at, updated_at
       FROM user_notes WHERE id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(noteId, userId)
      .first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse({ ok: true, note: normalizeNoteRow(row) }, 200);
  }

  if (parts.length === 1 && (method === 'PATCH' || method === 'PUT')) {
    const body = await request.json().catch(() => ({}));
    const fields = [];
    const binds = [];
    if (body.title != null) {
      fields.push('title = ?');
      binds.push(String(body.title).trim().slice(0, 200));
    }
    if (body.body != null || body.content != null) {
      fields.push('body = ?');
      binds.push(String(body.body ?? body.content).slice(0, 20000));
    }
    if (body.color != null) {
      fields.push('color = ?');
      binds.push(String(body.color).slice(0, 32));
    }
    if (body.pinned != null) {
      fields.push('pinned = ?');
      binds.push(body.pinned === true || body.pinned === 1 ? 1 : 0);
    }
    if (!fields.length) return jsonResponse({ error: 'No fields to update' }, 400);
    fields.push("updated_at = datetime('now')");
    binds.push(noteId, userId);
    const out = await env.DB.prepare(
      `UPDATE user_notes SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    )
      .bind(...binds)
      .run();
    if (!out.meta?.changes) return jsonResponse({ error: 'Not found' }, 404);
    const row = await env.DB.prepare(
      `SELECT id, title, body, color, pinned, created_at, updated_at FROM user_notes WHERE id = ? AND user_id = ?`,
    )
      .bind(noteId, userId)
      .first();
    return jsonResponse({ ok: true, note: normalizeNoteRow(row) }, 200);
  }

  if (parts.length === 1 && method === 'DELETE') {
    const out = await env.DB.prepare(`DELETE FROM user_notes WHERE id = ? AND user_id = ?`)
      .bind(noteId, userId)
      .run();
    if (!out.meta?.changes) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse({ ok: true, deleted: true }, 200);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

async function handleContactsApi(request, url, env, authUser, userId, workspaceId, parts, method) {
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  if (parts.length === 0 && method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const { results } = await env.DB.prepare(
      `SELECT id, display_name, username, email, phone, avatar_url, description, created_at, updated_at
       FROM user_contacts
       WHERE user_id = ?
       ORDER BY display_name COLLATE NOCASE ASC, created_at DESC
       LIMIT 200`,
    )
      .bind(userId)
      .all()
      .catch(() => ({ results: [] }));
    const rows = (results || []).filter((row) => {
      if (!q) return true;
      return (
        String(row.display_name || '').toLowerCase().includes(q) ||
        String(row.username || '').toLowerCase().includes(q) ||
        String(row.email || '').toLowerCase().includes(q) ||
        String(row.phone || '').toLowerCase().includes(q) ||
        String(row.description || '').toLowerCase().includes(q)
      );
    });
    return jsonResponse({ ok: true, contacts: rows.map(normalizeContactRow).filter(Boolean) }, 200);
  }

  if (parts.length === 0 && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const displayName = String(body?.display_name ?? body?.name ?? '').trim();
    if (!displayName) return jsonResponse({ error: 'display_name required' }, 400);
    const id = newId('ucontact');
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await env.DB.prepare(
      `INSERT INTO user_contacts
       (id, user_id, workspace_id, display_name, username, email, phone, avatar_url, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        userId,
        workspaceId,
        displayName.slice(0, 120),
        body?.username != null ? String(body.username).trim().slice(0, 80) : null,
        body?.email != null ? String(body.email).trim().slice(0, 254) : null,
        body?.phone != null ? String(body.phone).trim().slice(0, 40) : null,
        body?.avatar_url != null ? String(body.avatar_url).trim().slice(0, 2048) : null,
        body?.description != null ? String(body.description).trim().slice(0, 2000) : null,
        now,
        now,
      )
      .run();
    const row = await env.DB.prepare(
      `SELECT id, display_name, username, email, phone, avatar_url, description, created_at, updated_at
       FROM user_contacts WHERE id = ? AND user_id = ?`,
    )
      .bind(id, userId)
      .first();
    return jsonResponse({ ok: true, contact: normalizeContactRow(row) }, 201);
  }

  const contactId = parts[0] ? String(parts[0]).trim() : '';
  if (!contactId) return jsonResponse({ error: 'Not found' }, 404);

  if (parts.length === 1 && method === 'GET') {
    const row = await env.DB.prepare(
      `SELECT id, display_name, username, email, phone, avatar_url, description, created_at, updated_at
       FROM user_contacts WHERE id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(contactId, userId)
      .first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse({ ok: true, contact: normalizeContactRow(row) }, 200);
  }

  if (parts.length === 1 && (method === 'PATCH' || method === 'PUT')) {
    const body = await request.json().catch(() => ({}));
    const fields = [];
    const binds = [];
    const setField = (col, val) => {
      if (val !== undefined) {
        fields.push(`${col} = ?`);
        binds.push(val);
      }
    };
    setField('display_name', body.display_name != null ? String(body.display_name).trim().slice(0, 120) : undefined);
    setField('username', body.username != null ? String(body.username).trim().slice(0, 80) : undefined);
    setField('email', body.email != null ? String(body.email).trim().slice(0, 254) : undefined);
    setField('phone', body.phone != null ? String(body.phone).trim().slice(0, 40) : undefined);
    setField('avatar_url', body.avatar_url != null ? String(body.avatar_url).trim().slice(0, 2048) : undefined);
    setField('description', body.description != null ? String(body.description).trim().slice(0, 2000) : undefined);
    if (!fields.length) return jsonResponse({ error: 'No fields to update' }, 400);
    fields.push("updated_at = datetime('now')");
    binds.push(contactId, userId);
    const out = await env.DB.prepare(
      `UPDATE user_contacts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    )
      .bind(...binds)
      .run();
    if (!out.meta?.changes) return jsonResponse({ error: 'Not found' }, 404);
    const row = await env.DB.prepare(
      `SELECT id, display_name, username, email, phone, avatar_url, description, created_at, updated_at
       FROM user_contacts WHERE id = ? AND user_id = ?`,
    )
      .bind(contactId, userId)
      .first();
    return jsonResponse({ ok: true, contact: normalizeContactRow(row) }, 200);
  }

  if (parts.length === 1 && method === 'DELETE') {
    const out = await env.DB.prepare(`DELETE FROM user_contacts WHERE id = ? AND user_id = ?`)
      .bind(contactId, userId)
      .run();
    if (!out.meta?.changes) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse({ ok: true, deleted: true }, 200);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

export async function handleUserPersonalApi(request, url, env) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = (request.method || 'GET').toUpperCase();
  const authUser = await getAuthUser(request, env);
  if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  const userId = await resolveUserId(env, authUser);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const workspaceId = resolveWorkspaceId(authUser, env);

  if (path.startsWith('/api/user/notes')) {
    const parts = path.replace('/api/user/notes', '').split('/').filter(Boolean);
    return handleNotesApi(request, url, env, authUser, userId, workspaceId, parts, method);
  }

  if (path.startsWith('/api/user/contacts')) {
    const parts = path.replace('/api/user/contacts', '').split('/').filter(Boolean);
    return handleContactsApi(request, url, env, authUser, userId, workspaceId, parts, method);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
