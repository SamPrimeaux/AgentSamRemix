import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";

// Must run before any process.env reads below — ESM imports are hoisted, so
// server.js cannot dotenv after importing this module (QA / tkt_execos_server_peel_2026_08).
const __execosRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const __cfEnvPath =
  process.env.IAM_ENV_CLOUDFLARE || path.join(__execosRoot, ".env.cloudflare");
dotenv.config({ path: __cfEnvPath, quiet: true });
dotenv.config({ path: path.join(__execosRoot, ".env"), override: true, quiet: true });
// Docker lab: compose usually injects via env_file into process.env already; if
// `.env.docker` is present in the container cwd/root, load it without clobbering
// OS-injected secrets (no override).
dotenv.config({ path: path.join(__execosRoot, ".env.docker"), quiet: true });

export const PORT = process.env.PTY_PORT || 3099;
export const TOKEN = (process.env.PTY_AUTH_TOKEN || "").trim();
export const BRIDGE_KEY = (process.env.AGENTSAM_BRIDGE_KEY || "").trim();
export const isVpcOrigin = (req) => {
  const a = req.socket?.remoteAddress;
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
};
export const CWD =
  (process.env.IAM_WORKSPACES_ROOT || "").trim() ||
  (process.env.HOME || "").trim() ||
  (process.env.USERPROFILE || "").trim() ||
  "/tmp";
export const EXECOS_KEY = (process.env.EXECOS_KEY || "").trim();
/** Metadata / health only — NEVER used as exec fallback (tkt_0bfb31cbf5104393). */
export const EXECOS_DEFAULT_CWD_META =
  (process.env.EXECOS_DEFAULT_CWD || "").trim() ||
  (process.env.IAM_GCP_EXECOS_HOME || "").trim() ||
  "/tmp";
export const EXECOS_TIMEOUT_MS = Number(process.env.EXECOS_TIMEOUT_MS || 120000);
export const WORKER_URL = process.env.WORKER_URL || "https://inneranimalmedia.com";
/** Hostname this ExecOS instance advertises on session register. Mac ≠ GCP. */
export const TUNNEL_URL =
  (process.env.TUNNEL_URL || "").trim() ||
  (process.platform === "darwin"
    ? "https://localpty.inneranimalmedia.com"
    : "https://terminal.inneranimalmedia.com");
export const IS_WIN = process.platform === "win32";

/** Prefer bash first on Unix — zsh + bash-style PS1 (`\W`, `$(git…)`) spam-garbles the PTY. */
export function listShellCandidates() {
  if (IS_WIN) {
    for (const sh of ["pwsh", "powershell"]) {
      try {
        execFileSync(sh, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion"], {
          timeout: 2000,
          stdio: "ignore",
        });
        return [sh];
      } catch (_) {}
    }
    return ["powershell"];
  }
  const raw = ["/bin/bash", "/bin/zsh", process.env.SHELL, "/bin/sh"].filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of raw) {
    const t = String(p).trim();
    if (!t.startsWith("/") || seen.has(t)) continue;
    seen.add(t);
    if (existsSync(t)) out.push(t);
  }
  return out.length ? out : ["/bin/sh"];
}

export function ptySpawnArgs() {
  return IS_WIN ? [] : ["--login"];
}

function processHomeDir() {
  return (
    (process.env.HOME || "").trim() ||
    (process.env.USERPROFILE || "").trim() ||
    homedir() ||
    ""
  );
}

export const ENV_BASE = IS_WIN
  ? {
      ...process.env,
      PATH: process.env.PATH,
      USERPROFILE: process.env.USERPROFILE || process.env.HOME || processHomeDir(),
      HOME: processHomeDir(),
      TERM: "xterm-256color",
    }
  : {
      ...process.env,
      PATH:
        process.env.PATH ||
        "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: processHomeDir(),
      TERM: "xterm-256color",
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || process.env.LANG || "en_US.UTF-8",
    };

/** Cosmetic PTY prompt only — not an auth identity. Config may brand it; runtime must not name a person. */
export const DEFAULT_PTY_PROMPT_LABEL = "agent@inneranimalmedia";

/**
 * Theme `prompt_label` wins, then EXECOS_PROMPT_LABEL, then the platform-neutral default.
 */
export function resolvePtyPromptLabel(personality, env = process.env) {
  const fromPersonality = String(personality?.prompt_label ?? "").trim();
  const fromEnv = String(env?.EXECOS_PROMPT_LABEL ?? "").trim();
  return (fromPersonality || fromEnv || DEFAULT_PTY_PROMPT_LABEL).replace(/[\x00-\x1f"'`]/g, "");
}

/**
 * PTY prompt env from cms_themes.config.terminal.personality.
 * Keep static — bash `\W`/`\$` and `$(git branch …)` spam-garble under zsh.
 */
export function buildPtyPromptEnv(personality) {
  const label = resolvePtyPromptLabel(personality);
  return {
    PS1: `[ ${label} ]$ `,
    PROMPT: `[ ${label} ]%# `,
  };
}

/** @deprecated string form — prefer buildPtyPromptEnv */
export function buildPtyPrompt(personality) {
  return buildPtyPromptEnv(personality).PS1;
}

export async function fetchThemePersonality(themeSlug) {
  const base = (WORKER_URL || "").replace(/\/$/, "");
  if (!base) return null;
  const u = themeSlug
    ? `${base}/api/settings/theme?slug=${encodeURIComponent(themeSlug)}`
    : `${base}/api/settings/theme`;
  try {
    const res = await fetch(u, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.terminal?.personality ?? null;
  } catch (_) {
    return null;
  }
}

/** LOCAL-USER: IAM_PTY_* env wins over WS URL params when set on this host. */
export function resolveWsIdentity(url) {
  const envUser = (process.env.IAM_PTY_USER_ID || "").trim();
  const envTenant = (process.env.IAM_PTY_TENANT_ID || "").trim();
  const envWorkspace = (process.env.IAM_PTY_WORKSPACE_ID || "").trim();
  if (envUser) {
    return {
      userId: envUser,
      tenantId: envTenant || (url.searchParams.get("tenant_id") || "").trim(),
      workspaceId: envWorkspace || (url.searchParams.get("workspace_id") || "").trim(),
      lane: "local_user",
    };
  }
  const userId = (url.searchParams.get("user_id") || "").trim();
  const tenantId = (url.searchParams.get("tenant_id") || "").trim();
  const workspaceId = (url.searchParams.get("workspace_id") || "").trim();
  if (!userId || userId === "default") {
    return {
      userId: userId || "default",
      tenantId: tenantId || "default",
      workspaceId,
      lane: "operator",
    };
  }
  return { userId, tenantId, workspaceId, lane: "remote" };
}

export function resolveSessionCwd(url, identity) {
  const cwdParam = (url.searchParams.get("cwd") || "").trim();
  if (cwdParam) {
    try {
      mkdirSync(cwdParam, { recursive: true });
    } catch (_) {}
    return cwdParam;
  }
  // Operator lane: real git clone (not sparse /workspace tenant stubs).
  const operatorCwd = (
    process.env.EXECOS_DEFAULT_CWD ||
    process.env.IAM_GCP_OPERATOR_REPO ||
    ""
  ).trim();
  if (
    operatorCwd &&
    identity.lane === "operator" &&
    existsSync(operatorCwd)
  ) {
    return operatorCwd;
  }
  const root = process.env.IAM_WORKSPACES_ROOT || "/workspace";
  if (identity.tenantId && identity.userId && identity.userId !== "default") {
    const dir = path.join(root, identity.tenantId, identity.userId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const dir = path.join(root, identity.tenantId || "default", identity.userId || "default");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function log(msg) {
  console.log(`[PTY ${new Date().toISOString()}] ${msg}`);
}

export function safeSend(ws, data) {
  try {
    if (ws.readyState === 1) ws.send(data);
  } catch (err) {
    console.error("[PTY] send error:", err.message);
  }
}

/** CORE token_mint verify — returns CF credentials for PTY spawn env. */
export async function verifyTerminalSession(sessionId, sessionToken) {
  const sid = String(sessionId || "").trim();
  const tok = String(sessionToken || "").trim();
  if (!sid || !tok || !WORKER_URL) return null;
  try {
    const res = await fetch(`${WORKER_URL.replace(/\/$/, "")}/api/terminal/session/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        "X-Bridge-Key": BRIDGE_KEY,
      },
      body: JSON.stringify({ session_id: sid, token: tok }),
    });
    if (!res.ok) {
      log(`session verify HTTP ${res.status} for ${sid}`);
      return null;
    }
    const data = await res.json();
    if (!data?.valid) {
      log(`session verify rejected: ${data?.error || "invalid"}`);
      return null;
    }
    return data;
  } catch (err) {
    log(`session verify failed: ${err.message}`);
    return null;
  }
}

export function cloudflareEnvFromVerify(verifyPayload) {
  if (!verifyPayload) return {};
  const token =
    verifyPayload.cloudflare_api_token != null
      ? String(verifyPayload.cloudflare_api_token).trim()
      : "";
  const accountId =
    verifyPayload.cloudflare_account_id != null
      ? String(verifyPayload.cloudflare_account_id).trim()
      : "";
  const out = {};
  if (token) out.CLOUDFLARE_API_TOKEN = token;
  if (accountId) out.CLOUDFLARE_ACCOUNT_ID = accountId;
  return out;
}

export const MAX_BUFFER = 1000;
/** After last WS client leaves, wait this long before killing the PTY (reconnect grace).
 * Was 4h — left dozens of idle operator bash PTYs on the 1GB iam-tunnel VM. */
export const SESSION_GRACE_MS = 2 * 60 * 1000;
export const SESSION_INACTIVITY_MS = 5 * 60 * 1000;
/** Sweep interval — keep short on 1GB VM so orphans cannot linger long. */
export const SESSION_CHECK_INTERVAL_MS =
  Number(process.env.EXECOS_SESSION_CHECK_INTERVAL_MS) || 30 * 1000;

export const sessions = new Map();

process.on("uncaughtException", (err) => {
  console.error("[PTY] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[PTY] unhandledRejection:", reason);
});
