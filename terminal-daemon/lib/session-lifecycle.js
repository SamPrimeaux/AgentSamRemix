/**
 * Deterministic ExecOS PTY session lifecycle for the tiny iam-tunnel VM.
 *
 * Law:
 *   connected → last client disconnects → SESSION_GRACE_MS
 *     ├─ reconnect → cancel timer, reuse same PTY
 *     └─ expires → kill process group → clear timers → delete Map entry
 *
 * PTY exit/error → same destroy path immediately.
 * No session object may remain in `sessions` after its PTY is dead.
 */
import {
  sessions,
  log,
  SESSION_GRACE_MS,
  SESSION_INACTIVITY_MS,
  SESSION_CHECK_INTERVAL_MS,
} from "./pty-env.js";

/** Hard ceiling: absolute max lifetime even with clients (1GB VM). */
export const SESSION_MAX_AGE_MS = Number(process.env.EXECOS_SESSION_MAX_AGE_MS) || 2 * 60 * 60 * 1000;
/** Concurrent interactive PTYs per user_id. */
export const MAX_PTY_PER_USER = Number(process.env.EXECOS_MAX_PTY_PER_USER) || 3;
/** Concurrent interactive PTYs per workspace_id. */
export const MAX_PTY_PER_WORKSPACE = Number(process.env.EXECOS_MAX_PTY_PER_WORKSPACE) || 4;
/** Global concurrent interactive PTYs. */
export const MAX_PTY_GLOBAL = Number(process.env.EXECOS_MAX_PTY_GLOBAL) || 8;

/**
 * @param {import('node-pty').IPty | null | undefined} term
 */
export function killPtyProcessGroup(term) {
  if (!term) return;
  const pid = Number(term.pid);
  try {
    term.kill();
  } catch (_) {}
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === "win32") return;
  // Negative PID = process group (node-pty shells are typically session leaders).
  try {
    process.kill(-pid, "SIGTERM");
  } catch (_) {}
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (_) {}
    try {
      process.kill(pid, "SIGKILL");
    } catch (_) {}
  }, 1500).unref?.();
}

/**
 * Clear all timers on a session object (idempotent).
 * @param {Record<string, unknown>} session
 */
export function clearSessionTimers(session) {
  if (!session) return;
  if (session.killTimer) {
    clearTimeout(session.killTimer);
    session.killTimer = null;
  }
  if (session.inactivityTimer) {
    clearTimeout(session.inactivityTimer);
    session.inactivityTimer = null;
  }
  if (session.maxAgeTimer) {
    clearTimeout(session.maxAgeTimer);
    session.maxAgeTimer = null;
  }
}

/**
 * Full teardown — kill PTY/process group, close sockets, delete Map entry.
 * Idempotent: safe to call from grace expiry, inactivity, onExit, and sweeps.
 *
 * @param {string} sessionId
 * @param {string} [reason]
 * @returns {boolean} true if an entry was removed (or already gone after cleanup)
 */
export function destroySession(sessionId, reason = "destroy") {
  const id = String(sessionId || "").trim();
  if (!id) return false;
  const session = sessions.get(id);
  if (!session) return false;
  // kill → onExit may re-enter; still ensure Map deletion.
  if (session._destroying) {
    sessions.delete(id);
    return false;
  }
  session._destroying = true;

  log(`destroy session ${id} (${reason})`);
  clearSessionTimers(session);

  const term = session.term;
  session.term = null;
  killPtyProcessGroup(term);

  const clients = session.clients;
  if (clients && typeof clients.forEach === "function") {
    clients.forEach((c) => {
      try {
        c.close();
      } catch (_) {}
      try {
        c.terminate?.();
      } catch (_) {}
    });
    try {
      clients.clear();
    } catch (_) {}
  }

  sessions.delete(id);
  return true;
}

/** Kill every tracked PTY (ExecOS restart / SIGTERM). */
export function destroyAllSessions(reason = "shutdown") {
  for (const id of [...sessions.keys()]) {
    destroySession(id, reason);
  }
}

/**
 * Arm exactly one reconnect-grace reap timer after last client disconnects.
 * Repeated disconnects do not stack timers.
 *
 * @param {Record<string, unknown>} session
 * @param {string} sessionId
 */
export function armGraceReap(session, sessionId) {
  if (!session) return;
  if (session.clients && session.clients.size > 0) return;
  if (session.killTimer) return; // already armed — do not create another

  // While disconnected, inactivity timer must not race the grace path.
  if (session.inactivityTimer) {
    clearTimeout(session.inactivityTimer);
    session.inactivityTimer = null;
  }

  log(
    `session ${sessionId} has no clients — grace timer started (${SESSION_GRACE_MS / 60000} min)`,
  );
  session.killTimer = setTimeout(() => {
    session.killTimer = null;
    destroySession(sessionId, "grace_expired");
  }, SESSION_GRACE_MS);
  session.killTimer.unref?.();
}

/**
 * Cancel grace reap on reconnect (idempotent).
 * @param {Record<string, unknown>} session
 * @param {string} sessionId
 */
export function cancelGraceReap(session, sessionId) {
  if (!session?.killTimer) return;
  clearTimeout(session.killTimer);
  session.killTimer = null;
  log(`client reconnected to session ${sessionId}, grace timer cancelled`);
}

/**
 * Reset idle timer while clients are connected.
 * @param {Record<string, unknown>} session
 * @param {string} sessionId
 */
export function armSessionInactivityTimer(session, sessionId) {
  if (!session) return;
  // Do not arm idle kill while in grace (no clients) — grace owns that window.
  if (!session.clients || session.clients.size === 0) return;
  if (session.inactivityTimer) clearTimeout(session.inactivityTimer);
  session.inactivityTimer = setTimeout(() => {
    session.inactivityTimer = null;
    destroySession(sessionId, "inactivity");
  }, SESSION_INACTIVITY_MS);
  session.inactivityTimer.unref?.();
}

/**
 * Absolute max-age timer from session create.
 * @param {Record<string, unknown>} session
 * @param {string} sessionId
 */
export function armMaxAgeTimer(session, sessionId) {
  if (!session) return;
  if (session.maxAgeTimer) clearTimeout(session.maxAgeTimer);
  session.maxAgeTimer = setTimeout(() => {
    session.maxAgeTimer = null;
    destroySession(sessionId, "max_age");
  }, SESSION_MAX_AGE_MS);
  session.maxAgeTimer.unref?.();
}

/**
 * @param {Record<string, unknown>} session
 */
export function sessionHasLivePty(session) {
  return !!(session && session.term && session.term.pid);
}

/**
 * @returns {{
 *   active_sessions: number,
 *   disconnected_grace_sessions: number,
 *   idle_sessions: number,
 *   oldest_session_age_seconds: number,
 *   clients_total: number,
 *   sessions_tracked: number,
 * }}
 */
export function collectSessionStats() {
  const now = Date.now();
  let active = 0;
  let grace = 0;
  let clientsTotal = 0;
  let oldestAgeMs = 0;

  for (const session of sessions.values()) {
    const clients = session?.clients?.size || 0;
    clientsTotal += clients;
    const age = Math.max(0, now - Number(session?.createdAt || now));
    if (age > oldestAgeMs) oldestAgeMs = age;

    if (clients > 0 && sessionHasLivePty(session)) {
      active += 1;
    } else if (session?.killTimer && sessionHasLivePty(session)) {
      grace += 1;
    } else if (sessionHasLivePty(session)) {
      // Live PTY but no clients and no grace timer — treat as grace-equivalent idle.
      grace += 1;
    }
  }

  return {
    active_sessions: active,
    disconnected_grace_sessions: grace,
    idle_sessions: grace,
    oldest_session_age_seconds: Math.floor(oldestAgeMs / 1000),
    clients_total: clientsTotal,
    sessions_tracked: sessions.size,
  };
}

/**
 * Enforce concurrent caps before spawning a new PTY.
 * Prefers destroying oldest zero-client / grace sessions first.
 *
 * @param {{ userId?: string|null, workspaceId?: string|null }} identity
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function enforcePtyCaps(identity = {}) {
  const userId = String(identity.userId || "").trim();
  const workspaceId = String(identity.workspaceId || "").trim();

  const reapOldestDisposable = (predicate) => {
    /** @type {{ id: string, createdAt: number }[]} */
    const candidates = [];
    for (const [id, s] of sessions.entries()) {
      if (!predicate(s)) continue;
      const clients = s?.clients?.size || 0;
      if (clients > 0) continue;
      candidates.push({ id, createdAt: Number(s.createdAt || 0) });
    }
    candidates.sort((a, b) => a.createdAt - b.createdAt);
    if (!candidates.length) return false;
    destroySession(candidates[0].id, "cap_reap");
    return true;
  };

  const countMatching = (predicate) => {
    let n = 0;
    for (const s of sessions.values()) {
      if (predicate(s)) n += 1;
    }
    return n;
  };

  // Global
  while (sessions.size >= MAX_PTY_GLOBAL) {
    if (!reapOldestDisposable(() => true)) {
      return { ok: false, error: `pty_cap_global_${MAX_PTY_GLOBAL}` };
    }
  }

  if (userId) {
    while (
      countMatching((s) => String(s.userId || "").trim() === userId) >= MAX_PTY_PER_USER
    ) {
      if (
        !reapOldestDisposable((s) => String(s.userId || "").trim() === userId)
      ) {
        return { ok: false, error: `pty_cap_user_${MAX_PTY_PER_USER}` };
      }
    }
  }

  if (workspaceId) {
    while (
      countMatching((s) => String(s.workspaceId || "").trim() === workspaceId) >=
      MAX_PTY_PER_WORKSPACE
    ) {
      if (
        !reapOldestDisposable(
          (s) => String(s.workspaceId || "").trim() === workspaceId,
        )
      ) {
        return { ok: false, error: `pty_cap_workspace_${MAX_PTY_PER_WORKSPACE}` };
      }
    }
  }

  return { ok: true };
}

/** Periodic sweep: dead PTYs, max age, orphan Map entries. */
export function sweepStaleSessions() {
  const now = Date.now();
  for (const [id, session] of [...sessions.entries()]) {
    if (!session) {
      sessions.delete(id);
      continue;
    }
    if (!sessionHasLivePty(session)) {
      destroySession(id, "sweep_dead_pty");
      continue;
    }
    const age = now - Number(session.createdAt || now);
    if (age >= SESSION_MAX_AGE_MS) {
      destroySession(id, "sweep_max_age");
      continue;
    }
    // Zero clients without a grace timer — arm one (or destroy if somehow stale forever).
    const clients = session.clients?.size || 0;
    if (clients === 0 && !session.killTimer) {
      armGraceReap(session, id);
    }
  }
}

let _sweepStarted = false;
export function startSessionSweeper() {
  if (_sweepStarted) return;
  _sweepStarted = true;
  const t = setInterval(sweepStaleSessions, SESSION_CHECK_INTERVAL_MS);
  t.unref?.();
}
