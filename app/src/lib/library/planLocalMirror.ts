/**
 * Jailed local FSA mirror for Agent Sam plan markdown.
 *
 * SECURITY: the write target is ALWAYS derived here from a sanitized plan id —
 * never from a server- or SSE-supplied `path` string. This bounds every
 * auto-save / mirror write to `.agentsam/plans/plan-{id}.md` under the
 * connected Local folder, so a bug or future emit site cannot redirect a
 * background write into a real repo root that folder happens to contain
 * (e.g. `src/`, `plans/active/`). This is a *local, single-browser-user*
 * fallback only — it never touches R2, D1, git, or any other user/workspace.
 *
 * Soft-skip everywhere: Local not connected, permission not granted, or an
 * invalid plan id all resolve to `{ ok: false }` — callers must never treat
 * that as a plan-creation failure.
 */
import { writeConnectedLocalFile } from './writeConnectedLocalFile';

const PLAN_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PLAN_LOCAL_PATH_RE = /^\.agentsam\/plans\/plan-[A-Za-z0-9_-]{1,128}\.md$/;

/** Returns the jailed relative path, or null if planId doesn't match the allowed charset. */
export function planLocalRelPath(planId: string): string | null {
  const id = String(planId || '').trim();
  if (!PLAN_ID_RE.test(id)) return null;
  const path = `.agentsam/plans/plan-${id}.md`;
  return PLAN_LOCAL_PATH_RE.test(path) ? path : null;
}

export type PlanLocalMirrorResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; error: string };

export async function mirrorPlanMarkdownToLocal(
  planId: string,
  content: string,
  opts?: { requireExistingPermission?: boolean },
): Promise<PlanLocalMirrorResult> {
  const path = planLocalRelPath(planId);
  if (!path) return { ok: false, error: 'invalid_plan_id' };
  if (!content || !content.trim()) return { ok: false, error: 'empty_content' };
  const written = await writeConnectedLocalFile(path, content, {
    createDirs: true,
    requireExistingPermission: opts?.requireExistingPermission,
  });
  if (!written.ok) return { ok: false, error: written.error };
  return { ok: true, path: written.workspacePath, bytes: written.bytes };
}
