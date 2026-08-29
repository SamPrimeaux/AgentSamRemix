/** Canonical identity/session constants (SDK-portable defaults). */

export const IAM_KV_SESSION_KEY_PREFIX = 'iam_sess_v1:';
export const AUTH_COOKIE_NAME = 'session';
export const AUTH_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** Short-lived sessions minted for automation (POST /api/auth/agent-session/mint). */
export const MIN_AGENT_SESSION_TTL_SECONDS = 60;
export const MAX_AGENT_SESSION_TTL_SECONDS = 86400;
export const DEFAULT_AGENT_SESSION_TTL_SECONDS = 900;

/** Canonical browser routes (never send users to legacy `/login` or `/signup`). */
export const AUTH_LOGIN_PATH = '/auth/login';
export const AUTH_SIGNUP_PATH = '/auth/signup';
export const DASHBOARD_AFTER_LOGIN_PATH = '/dashboard/home';
