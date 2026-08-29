import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SessionUser, WorkspaceSummary } from '@inneranimalmedia/client-core';
import { registerIamServiceWorker } from "../pwa/registerServiceWorker";
import { ensureFreshDashboardBundle } from '../pwa/ensureFreshDashboardBundle';
import {
  prepareRecentWorkspacesForSession,
  persistRecentWorkspaceSwitch,
} from "../recentWorkspacesStorage";
import {
  clearIamWorkspaceSession,
  patchIamWorkspaceSessionCurrent,
  readIamWorkspaceSession,
  readUserPinnedWorkspace,
  writeUserPinnedWorkspace,
  writeIamWorkspaceSession,
  type IamWorkspaceSessionPayload,
  type IamWorkspaceSettingsRow,
} from "../iamWorkspaceStorage";
import { clearIamGitStatusCache } from "../iamGitStatusCache";
import { normalizeGithubRepo } from "../normalizeGithubRepo";
import { isDashboardBootstrapPath, loadDashboardBootstrap, refreshDashboardBootstrap } from "../loadDashboardBootstrap";
import { invalidateAgentDomainCache } from "../agentDomainFetch";
import { coalesceLabel } from "../lib/coalesceLabel";
import { handleAuthHttpStatus } from "../pwa/authSessionState";
import {
  clearExecutionWorkContext,
  readExecutionGithubRepo,
  readExecutionWorkspaceId,
} from "../lib/activateProjectWorkContext";

export type WorkspaceRow = WorkspaceSummary;

/** Resolved feature-flag map for the signed-in session (D1 → session/bootstrap). */
export type SessionFeatureFlags = Record<string, boolean>;

type WorkspaceContextValue = {
  sessionUserId: string | null;
  /** Signed-in user display name (first name preferred) — not workspace slug. */
  sessionUserName: string | null;
  /** Profile image from /api/auth/me (GitHub avatar, etc.). */
  sessionAvatarUrl: string | null;
  /**
   * Session feature flags (e.g. `agent_sam_fs_modes_v1`).
   * Prefer bootstrap/`me.feature_flags` when present; else GET /api/settings/feature-flags.
   */
  featureFlags: SessionFeatureFlags | null;
  workspaceId: string | null;
  setWorkspaceId: (id: string) => void;
  workspaces: WorkspaceRow[];
  displayName: string | null;
  setDisplayName: (name: string | null) => void;
  loading: boolean;
  /**
   * Bootstrap/workspaces fetch failed (network/timeout). Distinct from a real empty
   * account — Settings must not render this as "No active workspace".
   */
  loadError: string | null;
  /** Re-fetch GET /api/settings/workspaces and refresh sessionStorage + context. */
  refreshWorkspaces: (opts?: { force?: boolean }) => Promise<string | null>;
  /** Server-selected workspace from the last workspace-list response. */
  canonicalWorkspaceId: string | null;
  /** True when UI workspaceId differs from server canonical (informational only — no auto snap-back). */
  workspaceDrift: boolean;
  /** Switch active workspace: updates context, sessionStorage, and optionally syncs server. */
  switchWorkspace: (
    id: string,
    meta?: { displayName?: string; slug?: string; github_repo?: string | null; sync?: boolean },
  ) => Promise<void>;
  /** Persist repo pick to D1 workspaces.github_repo (status bar + git SSOT). */
  persistGithubRepo: (repoFullName: string, workspaceIdOverride?: string | null) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function rowDisplayName(row: IamWorkspaceSettingsRow): string | null {
  const aligned = typeof row.name === "string" ? row.name.trim() : "";
  if (aligned) return aligned;
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (slug) return slug;
  const dn = typeof row.display_name === "string" ? row.display_name.trim() : "";
  if (dn) return dn;
  return row.id || null;
}

function mapSettingsRow(row: IamWorkspaceSettingsRow): WorkspaceRow {
  const name = rowDisplayName(row) || row.id;
  const slug =
    typeof row.slug === "string" && row.slug.trim()
      ? row.slug.trim()
      : row.id.replace(/^ws_/, "") || row.id;
  return {
    id: row.id,
    name,
    slug,
    status: typeof row.status === "string" && row.status.trim() ? row.status.trim() : "active",
    github_repo: row.github_repo ?? null,
    root_path:
      typeof (row as { root_path?: string | null }).root_path === "string"
        ? (row as { root_path?: string | null }).root_path!.trim() || null
        : (row as { root_path?: string | null }).root_path ?? null,
    database_studio_name:
      typeof (row as { database_studio_name?: string }).database_studio_name === "string"
        ? (row as { database_studio_name?: string }).database_studio_name!.trim() || null
        : null,
  };
}

function pickActiveWorkspace(
  list: IamWorkspaceSettingsRow[],
  settingsCurrent: string | null | undefined,
): { id: string; displayName: string | null } | null {
  const rows = list.filter((w) => w && typeof w.id === "string");
  if (rows.length === 0) return null;
  const byId = (id: string) => rows.find((w) => w.id === id);

  const cur = typeof settingsCurrent === "string" ? settingsCurrent.trim() : "";
  if (cur) {
    const row = byId(cur);
    if (row) return { id: row.id, displayName: rowDisplayName(row) };
  }
  const first = rows[0];
  return { id: first.id, displayName: rowDisplayName(first) };
}

function applySessionPayload(
  payload: IamWorkspaceSessionPayload,
): {
  workspaceRows: WorkspaceRow[];
  workspaceId: string | null;
  displayName: string | null;
  canonicalWorkspaceId: string | null;
} {
  const workspaceRows = payload.data.filter((w) => w?.id).map(mapSettingsRow);
  const serverCurrent =
    typeof payload.current === "string" && payload.current.trim() ? payload.current.trim() : null;
  const picked = pickActiveWorkspace(payload.data, payload.current);
  const nextId =
    serverCurrent && workspaceRows.some((w) => w.id === serverCurrent)
      ? serverCurrent
      : picked?.id ?? serverCurrent;
  const row = nextId ? workspaceRows.find((w) => w.id === nextId) : null;
  return {
    workspaceRows,
    workspaceId: nextId,
    displayName: (row?.name?.trim() || picked?.displayName) ?? null,
    canonicalWorkspaceId: serverCurrent,
  };
}

async function fetchSettingsWorkspaces(): Promise<IamWorkspaceSessionPayload | null> {
  const r = await fetch("/api/settings/workspaces", { credentials: "same-origin" });
  if (!r.ok) return null;
  const d = (await r.json()) as {
    data?: IamWorkspaceSettingsRow[];
    current?: string | null;
    workspaceThemes?: Record<string, string>;
    workspaces?: Record<string, unknown>;
  };
  const data = Array.isArray(d.data) ? d.data.filter((w) => w && typeof w.id === "string") : [];
  const current =
    typeof d.current === "string" && d.current.trim() ? d.current.trim() : null;
  return {
    fetchedAt: Date.now(),
    sessionUserId: null,
    current,
    data,
    workspaceThemes: d.workspaceThemes,
    workspaces: d.workspaces,
  };
}

function applyInSessionWorkspacePick(
  payload: IamWorkspaceSessionPayload,
  userPickedId: string | null | undefined,
): IamWorkspaceSessionPayload {
  const explicit = typeof userPickedId === "string" ? userPickedId.trim() : "";
  if (!explicit) return payload;
  if (!payload.data.some((w) => w.id === explicit)) return payload;
  return { ...payload, current: explicit };
}

function coerceFeatureFlagsMap(
  raw: Record<string, unknown> | null | undefined,
): SessionFeatureFlags | null {
  if (!raw || typeof raw !== "object") return null;
  const out: SessionFeatureFlags = {};
  let any = false;
  for (const [k, v] of Object.entries(raw)) {
    if (!k) continue;
    any = true;
    out[k] =
      v === true ||
      v === 1 ||
      (typeof v === "string" && ["on", "1", "true", "yes"].includes(v.trim().toLowerCase()));
  }
  return any ? out : {};
}

/**
 * Resolve a boolean map from GET /api/settings/feature-flags until
 * bootstrap/`me.feature_flags` carries the session snapshot.
 */
function resolveFeatureFlagsFromSettingsPayload(payload: {
  flags?: Array<{ flag_key?: string; enabled_globally?: number | boolean }>;
  overrides?: Array<{ flag_key?: string; enabled?: number | boolean }>;
}): SessionFeatureFlags {
  const overrideByKey = new Map<string, boolean>();
  for (const o of payload.overrides || []) {
    const key = o?.flag_key != null ? String(o.flag_key).trim() : "";
    if (!key) continue;
    overrideByKey.set(key, o.enabled === true || Number(o.enabled) === 1);
  }
  const out: SessionFeatureFlags = {};
  for (const f of payload.flags || []) {
    const key = f?.flag_key != null ? String(f.flag_key).trim() : "";
    if (!key) continue;
    if (overrideByKey.has(key)) {
      out[key] = overrideByKey.get(key)!;
      continue;
    }
    out[key] = f.enabled_globally === true || Number(f.enabled_globally) === 1;
  }
  return out;
}

async function fetchSettingsFeatureFlags(): Promise<SessionFeatureFlags | null> {
  try {
    const r = await fetch("/api/settings/feature-flags", { credentials: "same-origin" });
    if (r.status === 401) {
      handleAuthHttpStatus(401, "/api/settings/feature-flags");
      return null;
    }
    if (!r.ok) return null;
    const body = (await r.json()) as {
      flags?: Array<{ flag_key?: string; enabled_globally?: number | boolean }>;
      overrides?: Array<{ flag_key?: string; enabled?: number | boolean }>;
      feature_flags?: Record<string, unknown>;
    };
    if (body.feature_flags && typeof body.feature_flags === "object") {
      return coerceFeatureFlagsMap(body.feature_flags) ?? {};
    }
    return resolveFeatureFlagsFromSettingsPayload(body);
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionUserName, setSessionUserName] = useState<string | null>(null);
  const [featureFlags, setFeatureFlags] = useState<SessionFeatureFlags | null>(null);
  const [sessionAvatarUrl, setSessionAvatarUrl] = useState<string | null>(null);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [canonicalWorkspaceId, setCanonicalWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sessionUserIdRef = useRef<string | null>(null);
  const workspaceIdRef = useRef<string | null>(null);
  /** Holds user-selected workspace until server refresh confirms the same id. */
  const userPickedWorkspaceRef = useRef<string | null>(null);
  const pendingWorkspaceIdRef = useRef<string | null>(null);
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null);
  const bootstrapDoneRef = useRef(false);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  const hydrateFromPayload = useCallback((payload: IamWorkspaceSessionPayload) => {
    const userId = sessionUserIdRef.current;
    const pinned = readUserPinnedWorkspace(userId);
    const pick =
      userPickedWorkspaceRef.current ||
      pendingWorkspaceIdRef.current ||
      pinned ||
      null;
    const merged = pick ? applyInSessionWorkspacePick(payload, pick) : payload;
    const applied = applySessionPayload(merged);
    setWorkspaces(applied.workspaceRows);
    setCanonicalWorkspaceId(applied.canonicalWorkspaceId);

    const pending = userPickedWorkspaceRef.current;
    let nextId = applied.workspaceId;
    if (
      pending &&
      pendingWorkspaceIdRef.current === pending &&
      applied.workspaceRows.some((w) => w.id === pending)
    ) {
      nextId = pending;
    }

    if (nextId) setWorkspaceIdState(nextId);
    const row = nextId ? applied.workspaceRows.find((w) => w.id === nextId) : null;
    if (row?.name?.trim()) setDisplayName(row.name.trim());
    else if (applied.displayName) setDisplayName(applied.displayName);

    const serverCurrent = typeof payload.current === "string" ? payload.current.trim() : "";
    if (userPickedWorkspaceRef.current && serverCurrent === userPickedWorkspaceRef.current) {
      userPickedWorkspaceRef.current = null;
      pendingWorkspaceIdRef.current = null;
      setPendingWorkspaceId(null);
    }
  }, []);

  const refreshWorkspaces = useCallback(async (opts?: { force?: boolean }): Promise<string | null> => {
    const userId = sessionUserIdRef.current;
    if (!opts?.force) {
      const cached = readIamWorkspaceSession(userId);
      if (cached && cached.data.length > 0) {
        if (!userId || !cached.sessionUserId || cached.sessionUserId === userId) {
          hydrateFromPayload(cached);
          setLoadError(null);
          setLoading(false);
          return (
            (typeof cached.current === 'string' && cached.current.trim()) ||
            cached.data[0]?.id ||
            workspaceIdRef.current ||
            null
          );
        }
      }
    }
    setLoading(true);
    setLoadError(null);
    try {
      const payload = await fetchSettingsWorkspaces();
      if (!payload) {
        setLoadError(
          'Could not load workspaces — check your connection and retry.',
        );
        return null;
      }
      payload.sessionUserId = userId;
      const merged = applyInSessionWorkspacePick(payload, userPickedWorkspaceRef.current);
      writeIamWorkspaceSession(merged);
      hydrateFromPayload(merged);
      setLoadError(null);
      return (
        (typeof merged.current === 'string' && merged.current.trim()) ||
        merged.data[0]?.id ||
        null
      );
    } catch {
      setLoadError(
        'Could not load workspaces — check your connection and retry.',
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [hydrateFromPayload]);

  const switchWorkspace = useCallback(
    async (
      id: string,
      meta?: { displayName?: string; slug?: string; github_repo?: string | null; sync?: boolean },
    ) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      const allowed = workspaces.some((w) => w.id === trimmed);
      if (!allowed && workspaces.length > 0) {
        console.warn('[workspace] switch blocked — not in accessible list', trimmed);
        return;
      }
      // Explicit workspace switch away from project-activate pin → drop sticky exec WS
      // so chat/approval/terminal follow the launcher (multi-repo chats stay undiluted).
      const execPin = readExecutionWorkspaceId();
      if (execPin && execPin !== trimmed) {
        clearExecutionWorkContext();
      }
      const userId = sessionUserIdRef.current;
      userPickedWorkspaceRef.current = trimmed;
      pendingWorkspaceIdRef.current = trimmed;
      setPendingWorkspaceId(trimmed);
      workspaceIdRef.current = trimmed;
      setWorkspaceIdState(trimmed);
      if (meta?.displayName?.trim()) setDisplayName(meta.displayName.trim());
      else {
        const row = workspaces.find((w) => w.id === trimmed);
        if (row?.name?.trim()) setDisplayName(row.name.trim());
      }

      patchIamWorkspaceSessionCurrent(trimmed, {
        id: trimmed,
        display_name: meta?.displayName,
        slug: meta?.slug,
        github_repo: meta?.github_repo,
      }, userId);

      persistRecentWorkspaceSwitch(userId, {
        id: trimmed,
        display_name: meta?.displayName || workspaces.find((w) => w.id === trimmed)?.name || trimmed,
        slug: meta?.slug || workspaces.find((w) => w.id === trimmed)?.slug || trimmed,
        updated_at: Math.floor(Date.now() / 1000),
      });

      writeUserPinnedWorkspace(userId, trimmed);

      const shouldSync = meta?.sync !== false;
      if (shouldSync) {
        try {
          const r = await fetch("/api/settings/workspaces/active", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              "X-IAM-Workspace-Id": trimmed,
            },
            body: JSON.stringify({ id: trimmed }),
          });
          const data = (await r.json().catch(() => ({}))) as {
            success?: boolean;
            workspace?: {
              id: string;
              display_name?: string;
              slug?: string;
              github_repo?: string | null;
            };
          };
          if (r.ok && data.workspace && data.workspace.id === trimmed) {
            patchIamWorkspaceSessionCurrent(trimmed, {
              id: data.workspace.id,
              display_name: data.workspace.display_name,
              slug: data.workspace.slug,
              github_repo: data.workspace.github_repo ?? null,
            }, userId);
            if (data.workspace.display_name?.trim()) {
              setDisplayName(data.workspace.display_name.trim());
            }
            writeUserPinnedWorkspace(userId, trimmed);
            if (isDashboardBootstrapPath()) {
              invalidateAgentDomainCache(trimmed);
              void refreshDashboardBootstrap();
            }
          } else if (!r.ok || data.workspace?.id !== trimmed) {
            console.warn('[workspace] server rejected workspace switch', trimmed);
          }
        } catch {
          /* local + sessionStorage already updated */
        }
      }

      void refreshWorkspaces({ force: true });

      window.dispatchEvent(new CustomEvent("iam_workspace_id"));
    },
    [workspaces, refreshWorkspaces],
  );

  const setWorkspaceId = useCallback((id: string) => {
    void switchWorkspace(id, { sync: false });
  }, [switchWorkspace]);

  const persistGithubRepo = useCallback(
    async (repoFullName: string, workspaceIdOverride?: string | null) => {
      const wsId = (workspaceIdOverride ?? workspaceId ?? "").trim();
      const normalized = normalizeGithubRepo(repoFullName);
      if (!wsId || !normalized) return;

      const pinnedRepo = readExecutionGithubRepo();
      if (pinnedRepo && normalizeGithubRepo(pinnedRepo) !== normalized) {
        clearExecutionWorkContext();
      }

      const current = workspaces.find((w) => w.id === wsId)?.github_repo?.trim() || null;
      if (current === normalized) return;

      setWorkspaces((prev) =>
        prev.map((w) => (w.id === wsId ? { ...w, github_repo: normalized } : w)),
      );
      patchIamWorkspaceSessionCurrent(wsId, { github_repo: normalized }, sessionUserIdRef.current);
      clearIamGitStatusCache();

      try {
        const r = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ github_repo: normalized }),
        });
        if (r.ok) {
          window.dispatchEvent(new CustomEvent("iam_workspace_github_repo", { detail: { workspaceId: wsId, github_repo: normalized } }));
        }
      } catch {
        /* local cache already updated */
      }
    },
    [workspaceId, workspaces],
  );

  useEffect(() => {
    if (bootstrapDoneRef.current) return;
    bootstrapDoneRef.current = true;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      let userId: string | null = null;
      const useBootstrap = isDashboardBootstrapPath();
      if (useBootstrap) {
        try {
          const boot = await loadDashboardBootstrap();
          if (boot?.me?.user?.id) {
            userId = String(boot.me.user.id).trim() || null;
            const rawName = coalesceLabel(boot.me.user.name, '');
            const emailLocal =
              boot.me.user.email != null ? String(boot.me.user.email).split("@")[0]?.trim() : "";
            setSessionUserName(rawName || emailLocal || null);
            const avatar =
              boot.me.user.avatar_url != null ? String(boot.me.user.avatar_url).trim() : "";
            setSessionAvatarUrl(avatar || null);
          }
          const bootFlags =
            coerceFeatureFlagsMap(boot?.me?.feature_flags as Record<string, unknown> | null) ??
            coerceFeatureFlagsMap(boot?.feature_flags as Record<string, unknown> | null);
          if (bootFlags) setFeatureFlags(bootFlags);
          if (boot?.workspaces?.data?.length) {
            const payload: IamWorkspaceSessionPayload = {
              fetchedAt: boot.fetched_at ?? Date.now(),
              sessionUserId: userId,
              current: boot.workspaces.current ?? null,
              data: boot.workspaces.data.map((w) => ({
                id: w.id,
                name: w.name ?? w.id,
                slug: w.slug ?? w.handle ?? w.id.replace(/^ws_/, ""),
                status: w.status ?? "active",
                github_repo: w.github_repo ?? null,
                database_studio_name: w.database_studio_name ?? null,
              })),
            };
            writeIamWorkspaceSession(payload);
            hydrateFromPayload(payload);
            setLoadError(null);
          }
        } catch {
          /* fall through to /api/auth/me */
        }
      }
      if (!userId) {
        try {
          const meRes = await fetch("/api/auth/me", { credentials: "same-origin" });
          if (meRes.status === 401) {
            handleAuthHttpStatus(401, "/api/auth/me");
          } else if (meRes.ok) {
            const me = (await meRes.json()) as {
              id?: string | null;
              avatar_url?: string | null;
              feature_flags?: Record<string, unknown> | null;
              user?: Pick<SessionUser, 'id' | 'name' | 'email' | 'avatar_url'>;
            };
            const rawId = me?.user?.id ?? me?.id;
            userId = rawId != null && String(rawId).trim() ? String(rawId).trim() : null;
            const rawName = coalesceLabel(me?.user?.name, '');
            const emailLocal =
              me?.user?.email != null ? String(me.user.email).split("@")[0]?.trim() : "";
            setSessionUserName(rawName || emailLocal || null);
            const avatar =
              (me?.user?.avatar_url != null ? String(me.user.avatar_url).trim() : "") ||
              (me?.avatar_url != null ? String(me.avatar_url).trim() : "");
            setSessionAvatarUrl(avatar || null);
            const meFlags = coerceFeatureFlagsMap(me?.feature_flags ?? null);
            if (meFlags) setFeatureFlags(meFlags);
          }
        } catch {
          /* ignore */
        }
      }
      if (cancelled) return;
      setSessionUserId(userId);
      sessionUserIdRef.current = userId;
      prepareRecentWorkspacesForSession(userId);

      // Bridge: settings feature-flags until bootstrap/me embeds session.feature_flags.
      if (userId) {
        void fetchSettingsFeatureFlags().then((flags) => {
          if (cancelled || !flags) return;
          setFeatureFlags((prev) => {
            if (prev && Object.keys(prev).length > 0) {
              return { ...flags, ...prev };
            }
            return flags;
          });
        });
      }

      if (userId) {
        void registerIamServiceWorker().then(() => {
          void ensureFreshDashboardBundle();
        });
      }

      const cached = readIamWorkspaceSession(userId);
      if (cached && cached.data.length > 0 && (!userId || !cached.sessionUserId || cached.sessionUserId === userId)) {
        const withUser = { ...cached, sessionUserId: userId };
        writeIamWorkspaceSession(withUser);
        hydrateFromPayload(withUser);
        setLoadError(null);
        if (!cancelled) setLoading(false);
        // Always refresh in background — bootstrap may have been stale/partial on flaky mobile.
        if (userId) {
          try {
            const fresh = await fetchSettingsWorkspaces();
            if (!cancelled && fresh) {
              fresh.sessionUserId = userId;
              const merged = applyInSessionWorkspacePick(fresh, userPickedWorkspaceRef.current);
              writeIamWorkspaceSession(merged);
              hydrateFromPayload(merged);
              setLoadError(null);
            }
          } catch {
            /* cache hydrate already applied — keep working offline-ish */
          }
        }
        return;
      }

      if (cached?.sessionUserId && userId && cached.sessionUserId !== userId) {
        clearIamWorkspaceSession(cached.sessionUserId);
      }

      // CRITICAL: dashboard bootstrap path used to skip this fetch when useBootstrap=true,
      // so a failed/empty /api/dashboard/bootstrap left workspaceId null forever and Settings
      // rendered "No active workspace" (looks like a broken account; usually bad signal).
      if (userId) {
        let lastErr: string | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (cancelled) return;
          try {
            const payload = await fetchSettingsWorkspaces();
            if (payload && payload.data.length > 0) {
              payload.sessionUserId = userId;
              const merged = applyInSessionWorkspacePick(payload, userPickedWorkspaceRef.current);
              writeIamWorkspaceSession(merged);
              hydrateFromPayload(merged);
              setLoadError(null);
              lastErr = null;
              break;
            }
            if (payload && payload.data.length === 0) {
              // Authenticated but genuinely no workspace rows — not a network failure.
              setLoadError(null);
              lastErr = null;
              break;
            }
            lastErr = 'Could not load workspaces — check your connection and retry.';
          } catch {
            lastErr = 'Could not load workspaces — check your connection and retry.';
          }
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
        if (!cancelled && lastErr) setLoadError(lastErr);
      } else if (!cancelled) {
        setLoadError('Could not verify session — check your connection and retry.');
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateFromPayload]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__ = workspaceId || "global";
    window.dispatchEvent(new CustomEvent("iam_workspace_id"));
  }, [workspaceId]);

  const workspaceDrift = useMemo(() => {
    if (pendingWorkspaceId) return false;
    if (!canonicalWorkspaceId || !workspaceId) return false;
    return workspaceId !== canonicalWorkspaceId;
  }, [canonicalWorkspaceId, workspaceId, pendingWorkspaceId]);

  const value = useMemo(
    () => ({
      sessionUserId,
      sessionUserName,
      sessionAvatarUrl,
      featureFlags,
      workspaceId,
      setWorkspaceId,
      workspaces,
      displayName,
      setDisplayName,
      loading,
      loadError,
      refreshWorkspaces,
      switchWorkspace,
      persistGithubRepo,
      canonicalWorkspaceId,
      workspaceDrift,
    }),
    [sessionUserId, sessionUserName, sessionAvatarUrl, featureFlags, workspaceId, setWorkspaceId, workspaces, displayName, loading, loadError, refreshWorkspaces, switchWorkspace, persistGithubRepo, canonicalWorkspaceId, workspaceDrift],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
