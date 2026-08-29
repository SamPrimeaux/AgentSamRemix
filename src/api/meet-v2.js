/**
 * src/api/meet-v2.js
 * RealtimeKit-backed Meet API (/api/meet/v2/*).
 * Gated by MEET_ENGINE=realtimekit and REALTIMEKIT_* Worker secrets.
 */

import { jsonResponse } from '../core/responses.js';
import { getAuthUser } from '../core/auth.js';
import {
  isMeetEngineRealtimeKit,
  presetForRole,
  rtkAddParticipant,
  rtkCreateMeeting,
  rtkGetMeeting,
  RealtimeKitConfigError,
  RealtimeKitApiError,
} from '../core/realtimekit-client.js';

function genRoomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function resolveWorkspaceIdLoose(authUser, env, body = null, url = null) {
  const fromSession = authUser?.workspace_id ?? authUser?.workspaceId ?? null;
  if (fromSession && String(fromSession).trim()) return String(fromSession).trim();
  const fromBody = body?.workspace_id ?? body?.workspaceId ?? null;
  if (fromBody && String(fromBody).trim()) return String(fromBody).trim();
  const fromQuery = url?.searchParams?.get('workspace_id') ?? null;
  if (fromQuery && String(fromQuery).trim()) return String(fromQuery).trim();
  const fromEnv = env?.WORKSPACE_ID ?? null;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return null;
}

function resolveTenantIdLoose(authUser, env) {
  const fromUser = authUser?.tenant_id ?? authUser?.tenantId ?? null;
  if (fromUser && String(fromUser).trim()) return String(fromUser).trim();
  const fromEnv = env?.TENANT_ID ?? null;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return null;
}

async function getUserId(request, env) {
  const user = await getAuthUser(request, env);
  const userId = user?.id || user?.userId || user?.user_id;
  return { user, userId };
}

function engineGate(env) {
  if (!isMeetEngineRealtimeKit(env)) {
    return jsonResponse(
      {
        error: 'meet_engine_not_realtimekit',
        message: 'Set MEET_ENGINE=realtimekit on the Worker to use /api/meet/v2/*.',
      },
      503,
    );
  }
  return null;
}

function rtkErrorResponse(err) {
  if (err instanceof RealtimeKitConfigError) {
    return jsonResponse({ error: 'realtimekit_not_configured', message: err.message }, 503);
  }
  if (err instanceof RealtimeKitApiError) {
    return jsonResponse(
      { error: 'realtimekit_api_error', message: err.message, status: err.status },
      err.status >= 400 && err.status < 600 ? err.status : 502,
    );
  }
  return jsonResponse({ error: err?.message ?? String(err) }, 500);
}

/** POST /api/meet/v2/start — create D1 meet_rooms row + RTK meeting */
async function handleV2Start(request, env) {
  const gate = engineGate(env);
  if (gate) return gate;

  const { user, userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? 'Meeting').trim() || 'Meeting';
  const roomId = body.roomId ? String(body.roomId).trim() : genRoomId();
  const workspaceId = resolveWorkspaceIdLoose(user, env, body, url);
  const tenantId = resolveTenantIdLoose(user, env);
  const hostPreset = String(body.hostPreset ?? 'group_call_host').trim() || 'group_call_host';

  let meeting;
  try {
    meeting = await rtkCreateMeeting(env, { title: name });
  } catch (err) {
    return rtkErrorResponse(err);
  }

  const meetingId = meeting?.id != null ? String(meeting.id) : null;
  if (!meetingId) {
    return jsonResponse({ error: 'realtimekit_meeting_id_missing' }, 502);
  }

  await env.DB.prepare(
    `INSERT INTO meet_rooms (
      id, name, created_by, status, workspace_id, tenant_id,
      realtimekit_meeting_id, engine, realtimekit_host_preset
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, 'realtimekit', ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      status = 'active',
      workspace_id = COALESCE(excluded.workspace_id, meet_rooms.workspace_id),
      tenant_id = COALESCE(excluded.tenant_id, meet_rooms.tenant_id),
      realtimekit_meeting_id = excluded.realtimekit_meeting_id,
      engine = 'realtimekit',
      realtimekit_host_preset = excluded.realtimekit_host_preset`,
  )
    .bind(roomId, name, userId, workspaceId, tenantId, meetingId, hostPreset)
    .run();

  return jsonResponse({
    ok: true,
    roomId,
    meetingId,
    engine: 'realtimekit',
    meetingStatus: meeting?.status ?? null,
  });
}

/** POST /api/meet/v2/token — mint participant auth token for SDK */
async function handleV2Token(request, env) {
  const gate = engineGate(env);
  if (gate) return gate;

  const { user, userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const roomId = body.roomId != null ? String(body.roomId).trim() : '';
  if (!roomId) return jsonResponse({ error: 'roomId required' }, 400);

  const roleRaw = body.role != null ? String(body.role).trim().toLowerCase() : 'participant';
  const role = roleRaw === 'host' || roleRaw === 'guest' ? roleRaw : 'participant';
  const displayName =
    String(body.displayName ?? body.name ?? user?.name ?? user?.email ?? 'Guest').trim() ||
    'Guest';

  const room = await env.DB.prepare(
    `SELECT id, name, created_by, realtimekit_meeting_id, engine, realtimekit_host_preset, status
     FROM meet_rooms WHERE id = ? LIMIT 1`,
  )
    .bind(roomId)
    .first();

  if (!room) {
    return jsonResponse({ error: 'room_not_found' }, 404);
  }

  if (room.status === 'scheduled') {
    await env.DB.prepare(`UPDATE meet_rooms SET status = 'active' WHERE id = ?`).bind(roomId).run();
  }

  let meetingId = room.realtimekit_meeting_id != null ? String(room.realtimekit_meeting_id) : '';
  if (!meetingId) {
    try {
      const created = await rtkCreateMeeting(env, { title: String(room.name || 'IAM Meet') });
      meetingId = created?.id != null ? String(created.id) : '';
      if (!meetingId) {
        return jsonResponse({ error: 'realtimekit_meeting_id_missing' }, 502);
      }
      await env.DB.prepare(
        `UPDATE meet_rooms SET realtimekit_meeting_id = ?, engine = 'realtimekit' WHERE id = ?`,
      )
        .bind(meetingId, roomId)
        .run();
    } catch (err) {
      return rtkErrorResponse(err);
    }
  }

  const isHost = role === 'host' || String(room.created_by) === String(userId);
  let presetName = presetForRole(isHost ? 'host' : role);
  if (isHost && room.realtimekit_host_preset) {
    presetName = String(room.realtimekit_host_preset);
  }

  try {
    const participant = await rtkAddParticipant(env, meetingId, {
      name: displayName,
      presetName,
      customParticipantId: userId,
    });
    const authToken = participant?.token != null ? String(participant.token) : null;
    if (!authToken) {
      return jsonResponse({ error: 'participant_token_missing' }, 502);
    }
    return jsonResponse({
      ok: true,
      authToken,
      participantId: participant?.id ?? null,
      presetName,
      role: isHost ? 'host' : role,
      roomId,
      meetingId,
    });
  } catch (err) {
    return rtkErrorResponse(err);
  }
}

/** GET /api/meet/v2/room/:id — room metadata + RTK meeting status */
async function handleV2RoomGet(request, env, roomId) {
  const gate = engineGate(env);
  if (gate) return gate;

  const { userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const room = await env.DB.prepare(
    `SELECT id, name, created_by, created_at, status, workspace_id, tenant_id,
            realtimekit_meeting_id, engine, realtimekit_host_preset
     FROM meet_rooms WHERE id = ? LIMIT 1`,
  )
    .bind(roomId)
    .first();

  if (!room) return jsonResponse({ error: 'room_not_found' }, 404);

  let meeting = null;
  if (room.realtimekit_meeting_id) {
    try {
      meeting = await rtkGetMeeting(env, String(room.realtimekit_meeting_id));
    } catch (err) {
      if (!(err instanceof RealtimeKitApiError && err.status === 404)) {
        return rtkErrorResponse(err);
      }
    }
  }

  return jsonResponse({
    ok: true,
    room: {
      id: room.id,
      name: room.name,
      status: room.status,
      engine: room.engine ?? 'legacy',
      createdAt: room.created_at,
      createdBy: room.created_by,
      workspaceId: room.workspace_id ?? null,
      meetingId: room.realtimekit_meeting_id ?? null,
      hostPreset: room.realtimekit_host_preset ?? null,
    },
    meeting,
  });
}

export async function handleMeetV2Api(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.replace('/api/meet/v2', '').split('/').filter(Boolean);
  const method = request.method;

  if (parts[0] === 'start' && !parts[1] && method === 'POST') {
    return handleV2Start(request, env);
  }

  if (parts[0] === 'token' && !parts[1] && method === 'POST') {
    return handleV2Token(request, env);
  }

  if (parts[0] === 'room' && parts[1] && !parts[2] && method === 'GET') {
    return handleV2RoomGet(request, env, parts[1]);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
