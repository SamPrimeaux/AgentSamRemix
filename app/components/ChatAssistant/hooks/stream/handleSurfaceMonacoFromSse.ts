/**
 * capability_selected / surface_open / monaco_files_generated / code_diff / preview_artifact / file_staged SSE.
 */
import { sanitizeBrowserNavigateUrl } from '../../../../lib/sanitizeBrowserUrl';
import { mirrorPlanMarkdownToLocal } from '../../../../src/lib/library/planLocalMirror';
import type {
  AgentGeneratedFile,
  AgentPreviewArtifact,
  AgentPreviewArtifactKind,
} from '../../types';
import { patchIamAgentStreamDebug } from '../../streamDebug';
import { resolveAgentFileKind } from './sseHelpers';
import {
  agentFilesFromImageSse,
  appendAgentFilesToAssistantTail,
} from './sseHelpersMedia';
import type { SseSession, SseDispatchResult } from './sseTypes';

export function handleSurfaceMonacoFromSse(
  s: SseSession,
  data: unknown,
  evType: string | undefined,
): SseDispatchResult {
if (
  data &&
  typeof data === 'object' &&
  ((data as { type?: string }).type === 'capability_selected' ||
    (data as { type?: string }).type === 'agent_capability_selected')
) {
  const d = data as { decision?: Record<string, unknown> };
  const dec = d.decision;
  if (dec && typeof dec === 'object') {
    patchIamAgentStreamDebug({ capability_decision: dec });
  }
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  ((data as { type?: string }).type === 'surface_open' ||
    (data as { type?: string }).type === 'agent_surface_open')
) {
  const d = data as {
    surface?: string;
    url?: string;
    reason?: string;
    load_url?: string;
    artifact_id?: string;
    artifact_type?: string;
    project_slug?: string;
    page_id?: string;
    panel?: string;
    bucket?: string;
    key?: string;
    workspace_path?: string;
    github_repo?: string;
    github_path?: string;
    github_branch?: string;
    port?: number;
    domain?: string;
    target?: Record<string, unknown>;
  };
  window.dispatchEvent(
    new CustomEvent('iam:agent-open-surface', {
      detail: {
        surface: d.surface,
        url: d.url,
        reason: d.reason,
        load_url: d.load_url,
        artifact_id: d.artifact_id,
        artifact_type: d.artifact_type,
        project_slug: d.project_slug,
        page_id: d.page_id,
        panel: d.panel,
        bucket: d.bucket,
        key: d.key,
        workspace_path: d.workspace_path,
        github_repo: d.github_repo,
        github_path: d.github_path,
        github_branch: d.github_branch,
        port: d.port,
        domain: d.domain,
        target: d.target,
        ...(d.surface === 'browser' && s.activeAgentRunId
          ? { agent_live: true }
          : {}),
      },
    }),
  );
  if (d.surface === 'browser' && typeof d.url === 'string' && d.url.trim()) {
    const navUrl = sanitizeBrowserNavigateUrl(d.url);
    if (navUrl && !/\/api\/r2\/file\b/i.test(navUrl)) {
      s.ctx.onBrowserNavigate?.({
        type: 'browser_navigate',
        url: navUrl,
        agent_live: Boolean(s.activeAgentRunId),
        automation: Boolean(s.activeAgentRunId),
      });
    }
  }
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  ((data as { type?: string }).type === 'monaco_files_generated' ||
    (data as { type?: string }).type === 'monaco_file_generated')
) {
  const payload = data as { type?: string; files?: unknown[]; plan_id?: string };
  const batch = Array.isArray(payload.files) && payload.files.length ? payload.files : [data];
  const openMonacoFiles = async () => {
    for (const raw of batch) {
      if (!raw || typeof raw !== 'object') return 'continue';
      const f = raw as {
        filename?: string;
        path?: string;
        language?: string;
        content?: string;
        plan_id?: string;
        r2_url?: string;
      };
      const batchPlanId =
        typeof (data as { plan_id?: string }).plan_id === 'string'
          ? (data as { plan_id: string }).plan_id.trim()
          : '';
      let content = typeof f.content === 'string' ? f.content : '';
      const path = typeof f.path === 'string' ? f.path.trim() : '';
      const filename =
        (typeof f.filename === 'string' && f.filename.trim()) ||
        path.split('/').pop() ||
        'untitled';
      const planId =
        (typeof f.plan_id === 'string' && f.plan_id.trim()) || batchPlanId || '';
      const r2Url = typeof f.r2_url === 'string' ? f.r2_url.trim() : '';
      if (!content && r2Url) {
        try {
          const r = await fetch(r2Url, { credentials: 'include' });
          if (r.ok) content = await r.text();
        } catch {
          /* ignore fetch errors */
        }
      }
      if (!content) return 'continue';
      // Do not auto-open Monaco — files are stamped onto the assistant bubble below
      // (genFiles) and open only when the operator clicks scratchpad / fence.

      // Auto-mirror plan markdown into the connected Local folder under
      // `.agentsam/plans/` — a safe local fallback (Cursor-style `.cursor`
      // default), independent from "Save to workspace" (R2/My artifacts).
      // Security: the write target is re-derived from `planId` alone
      // (never from `path`/`f.path` above), and only fires when this file
      // is unambiguously the plan markdown itself (exact filename match +
      // markdown language) — a Build-stage `monaco_file_generated` for an
      // arbitrary repo file also carries `plan_id` and must never be
      // routed into the plan mirror. Soft-skip on any failure; never
      // blocks or errors the chat stream.
      if (planId && filename === `plan-${planId}.md` && (!f.language || f.language === 'markdown')) {
        void mirrorPlanMarkdownToLocal(planId, content, { requireExistingPermission: true }).catch(() => {});
      }
    }
    // Do not dispatch iam:agent-open-surface for monaco_file_generated — never auto-open editor.
  };
  void openMonacoFiles();
  s.fileEchoSuppress = true;

  // Stamp file entries onto the current assistant message for the files panel
  const genFiles: AgentGeneratedFile[] = batch
    .filter((raw): raw is NonNullable<typeof raw> => raw != null && typeof raw === 'object')
    .map((raw) => {
      const f = raw as { filename?: string; path?: string; content?: string; r2_url?: string };
      const path = typeof f.path === 'string' ? f.path.trim() : '';
      const filename =
        (typeof f.filename === 'string' && f.filename.trim()) ||
        path.split('/').pop() ||
        'output';
      const r2Url = typeof f.r2_url === 'string' ? f.r2_url.trim() : undefined;
      const content = typeof f.content === 'string' && f.content.length < 32000 ? f.content : undefined;
      return {
        filename,
        r2Url,
        content,
        workspacePath: path || filename,
        kind: resolveAgentFileKind(filename),
      };
    })
    .filter((gf) => gf.filename);

  if (genFiles.length) {
    s.ctx.setMessages((prev) => {
      const next = [...prev];
      const idx = next.length - 1;
      if (idx < 0 || next[idx].role !== 'assistant') return prev;
      const existing = next[idx].agentFiles ?? [];
      const seen = new Set(existing.map((x) => x.workspacePath ?? x.filename));
      const fresh = genFiles.filter((gf) => !seen.has(gf.workspacePath ?? gf.filename));
      if (!fresh.length) return prev;
      next[idx] = { ...next[idx], agentFiles: [...existing, ...fresh] };
      return next;
    });
  }

  return 'continue';
}
if (evType === 'code_diff') {
  const d = data as {
    path?: string;
    before?: string;
    after?: string;
    language?: string;
  };
  const path = typeof d.path === 'string' ? d.path.trim() : '';
  const before = typeof d.before === 'string' ? d.before : '';
  const after = typeof d.after === 'string' ? d.after : '';
  if (path && before !== after) {
    const art: AgentPreviewArtifact = {
      id: `diff_${path.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)}_${Date.now().toString(36)}`,
      kind: 'diff',
      path,
      before,
      content: after,
      language: typeof d.language === 'string' ? d.language : undefined,
      title: path,
    };
    s.ctx.setMessages((prev) => {
      const next = [...prev];
      const idx = next.length - 1;
      if (idx < 0 || next[idx].role !== 'assistant') return prev;
      const prevArts = next[idx].previewArtifacts || [];
      if (prevArts.some((x) => x.id === art.id)) return prev;
      next[idx] = { ...next[idx], previewArtifacts: [...prevArts, art] };
      return next;
    });
  }
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'preview_artifact') {
  const d = data as {
    type: string;
    artifact?: {
      id?: string;
      kind?: string;
      title?: string;
      content?: string;
      language?: string;
      imageUrl?: string;
    };
  };
  const raw = d.artifact;
  if (raw && typeof raw.id === 'string' && raw.id.trim()) {
    const k = String(raw.kind || 'code');
    const kind: AgentPreviewArtifactKind =
      k === 'sql' || k === 'diff' || k === 'code' || k === 'image' || k === 'table' ? k : 'code';
    const art: AgentPreviewArtifact = {
      id: raw.id.trim(),
      kind,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      content: typeof raw.content === 'string' ? raw.content : undefined,
      language: typeof raw.language === 'string' ? raw.language : undefined,
      imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : undefined,
      before: typeof (raw as { before?: string }).before === 'string' ? (raw as { before: string }).before : undefined,
      path: typeof (raw as { path?: string }).path === 'string' ? (raw as { path: string }).path : undefined,
    };
    s.ctx.setMessages((prev) => {
      const next = [...prev];
      const idx = next.length - 1;
      if (idx < 0 || next[idx].role !== 'assistant') return prev;
      const prevArts = next[idx].previewArtifacts || [];
      if (prevArts.some((x) => x.id === art.id)) return prev;
      next[idx] = { ...next[idx], previewArtifacts: [...prevArts, art] };
      return next;
    });
    if (kind === 'image' && art.imageUrl) {
      appendAgentFilesToAssistantTail(
        s.ctx.setMessages,
        agentFilesFromImageSse({
          image_url: art.imageUrl,
          generation_id: art.id,
        }),
      );
    }
  }
  return 'continue';
}
if (evType === 'file_staged' || (data && typeof data === 'object' && (data as { type?: string }).type === 'file_staged')) {
  const d = data as {
    path?: string;
    mime?: string | null;
    size_bytes?: number;
    updated?: boolean;
    preview?: { kind?: string; text?: string; truncated?: boolean };
    staged_ref?: { bucket?: string; key?: string; etag?: string | null; path?: string };
  };
  const path = typeof d.path === 'string' ? d.path.trim() : '';
  if (!path) return 'continue';
  const filename = path.split('/').pop() || path;
  const previewText =
    d.preview?.kind === 'text' && typeof d.preview.text === 'string' ? d.preview.text : undefined;
  const stagedRef =
    d.staged_ref && typeof d.staged_ref.key === 'string'
      ? {
          bucket: String(d.staged_ref.bucket || 'inneranimalmedia'),
          key: String(d.staged_ref.key),
          etag: d.staged_ref.etag != null ? String(d.staged_ref.etag) : null,
          path: String(d.staged_ref.path || path),
        }
      : undefined;
  const gen: AgentGeneratedFile = {
    filename,
    content: previewText && previewText.length < 32000 ? previewText : undefined,
    workspacePath: path,
    kind: resolveAgentFileKind(filename),
    staged: true,
    stagedUpdated: d.updated === true,
    stagedRef,
  };
  s.ctx.setMessages((prev) => {
    const next = [...prev];
    const idx = next.length - 1;
    if (idx < 0 || next[idx].role !== 'assistant') return prev;
    const existing = next[idx].agentFiles ?? [];
    const key = path;
    const without = existing.filter((x) => (x.workspacePath || x.filename) !== key);
    next[idx] = { ...next[idx], agentFiles: [...without, gen] };
    const artId = `staged_${path.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48)}`;
    const art: AgentPreviewArtifact = {
      id: artId,
      kind: 'code',
      path,
      title: d.updated ? `Staged (updated) · ${filename}` : `Staged · ${filename}`,
      content: previewText,
      language: filename.split('.').pop() || undefined,
    };
    const prevArts = next[idx].previewArtifacts || [];
    const artsWithout = prevArts.filter((x) => x.id !== artId && x.path !== path);
    next[idx] = { ...next[idx], previewArtifacts: [...artsWithout, art] };
    return next;
  });
  return 'continue';
}
  return 'fallthrough';
}
