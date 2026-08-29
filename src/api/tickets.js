/**
 * GET    /api/tickets?status=&project=&client_id=&surface=&starred=1&q=&workable=1
 * GET    /api/tickets/analytics
 * POST   /api/tickets
 * GET    /api/tickets/:id
 * PATCH  /api/tickets/:id
 * DELETE /api/tickets/:id
 * POST   /api/tickets/:id/status  { status, status_reason? }
 * POST   /api/tickets/:id/events { event_type, detail?, commit_sha? }
 * GET    /api/tickets/:id/events
 *
 * Index only — prose lives at ticket.doc_path (plans/active|backlog).
 * Platform engineering and Collaborate Tasks are separated by `surface`.
 * Does not remove or replace agentsam_todo consumers outside Collaborate Tasks.
 * Hard delete only — abandoned is a status, not soft-delete.
 */

import { jsonResponse } from '../core/responses.js';
import {
  addTicketEvent,
  createTicket,
  deleteTicket,
  getTicket,
  getTicketAnalytics,
  listTicketEvents,
  listTickets,
  setTicketStatus,
  updateTicketFields,
} from '../core/agentsam-tickets.js';

/**
 * @param {Request} request
 * @param {URL} url
 * @param {unknown} env
 * @param {{ id?: string } | null} authUser
 */
export async function handleTicketsApi(request, url, env, authUser) {
  if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  const path = url.pathname.replace(/\/$/, '') || '/';
  const pathLower = path.toLowerCase();
  const method = request.method.toUpperCase();
  const actor = { actor_type: 'dashboard_user', actor_id: String(authUser.id) };

  if (pathLower === '/api/tickets/analytics' && method === 'GET') {
    try {
      const analytics = await getTicketAnalytics(env);
      return jsonResponse({ ok: true, analytics });
    } catch (e) {
      return jsonResponse({ error: e?.message || 'analytics failed' }, 500);
    }
  }

  if (pathLower === '/api/tickets' && method === 'GET') {
    try {
      const tickets = await listTickets(env, {
        status: url.searchParams.get('status'),
        project: url.searchParams.get('project'),
        client_id: url.searchParams.get('client_id'),
        subsystem: url.searchParams.get('subsystem'),
        priority: url.searchParams.get('priority'),
        surface: url.searchParams.get('surface'),
        q: url.searchParams.get('q'),
        starred:
          url.searchParams.get('starred') === '1' ||
          url.searchParams.get('starred') === 'true',
        workable:
          url.searchParams.get('workable') === '1' ||
          url.searchParams.get('workable') === 'true',
        limit: parseInt(url.searchParams.get('limit') || '100', 10),
      });
      return jsonResponse({ ok: true, tickets });
    } catch (e) {
      return jsonResponse({ error: e?.message || 'list failed' }, 500);
    }
  }

  if (pathLower === '/api/tickets' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    try {
      const ticket = await createTicket(env, { ...body, ...actor });
      return jsonResponse({ ok: true, ticket }, 201);
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : 'create failed';
      const status = msg.includes('required') || msg.startsWith('invalid_') ? 400 : 500;
      return jsonResponse({ error: msg }, status);
    }
  }

  const statusMatch = path.match(/^\/api\/tickets\/([^/]+)\/status$/i);
  if (statusMatch && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    try {
      const ticket = await setTicketStatus(env, statusMatch[1], { ...body, ...actor });
      return jsonResponse({ ok: true, ticket });
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : 'status failed';
      const status =
        msg === 'ticket_not_found'
          ? 404
          : msg.includes('required') || msg.startsWith('invalid_')
            ? 400
            : 500;
      return jsonResponse({ error: msg }, status);
    }
  }

  const eventsMatch = path.match(/^\/api\/tickets\/([^/]+)\/events$/i);
  if (eventsMatch && method === 'GET') {
    try {
      const events = await listTicketEvents(env, eventsMatch[1]);
      return jsonResponse({ ok: true, events });
    } catch (e) {
      return jsonResponse({ error: e?.message || 'events failed' }, 500);
    }
  }
  if (eventsMatch && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    try {
      const out = await addTicketEvent(env, eventsMatch[1], { ...body, ...actor });
      return jsonResponse(out);
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : 'event failed';
      const status =
        msg === 'ticket_not_found' ? 404 : msg.startsWith('invalid_') ? 400 : 500;
      return jsonResponse({ error: msg }, status);
    }
  }

  const idMatch = path.match(/^\/api\/tickets\/([^/]+)$/i);
  if (idMatch && method === 'GET') {
    try {
      const ticket = await getTicket(env, idMatch[1]);
      if (!ticket) return jsonResponse({ error: 'ticket_not_found' }, 404);
      return jsonResponse({ ok: true, ticket });
    } catch (e) {
      return jsonResponse({ error: e?.message || 'get failed' }, 500);
    }
  }
  if (idMatch && method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    if (body.status != null) {
      return jsonResponse({ error: 'use POST /api/tickets/:id/status for status changes' }, 400);
    }
    try {
      const ticket = await updateTicketFields(env, idMatch[1], body);
      return jsonResponse({ ok: true, ticket });
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : 'update failed';
      const status =
        msg === 'ticket_not_found'
          ? 404
          : msg.startsWith('invalid_') || msg.includes('required')
            ? 400
            : 500;
      return jsonResponse({ error: msg }, status);
    }
  }
  if (idMatch && method === 'DELETE') {
    try {
      const out = await deleteTicket(env, idMatch[1]);
      return jsonResponse(out);
    } catch (e) {
      const msg = e?.message != null ? String(e.message) : 'delete failed';
      return jsonResponse({ error: msg }, msg === 'ticket_not_found' ? 404 : 500);
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
