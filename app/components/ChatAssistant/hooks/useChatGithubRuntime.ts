/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GitHub repo context, Files-rail explorer bind, runtime checks, exec lane, context hub.
 * Peel A1 companion — mechanical extract from ChatAssistant.tsx.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  IAM_FILES_SOURCE_CONTEXT_EVENT,
  IAM_FILES_SOURCE_CONTEXT_REQUEST_EVENT,
  type AgentSamFsSourceContext,
} from '../../../src/lib/agentSamFilesystemTypes';
import {
  githubRepoContextStorageKey,
  chatGithubContextStorageKey,
  readChatGithubContext,
  writeChatGithubContext,
} from '../types';
import type { ContextHubLane } from '../ContextHubDrawer';
import {
  readDockExecLane,
  writeDockExecLane,
  type ExecLane,
} from '../../../src/lib/execLane';

export type UseChatGithubRuntimeArgs = {
  sessionUserId: string | null | undefined;
  effectiveWsId: string | null;
  conversationId: string;
  agentsamPolicy: Record<string, unknown> | null | undefined;
  isNarrow: boolean;
  workspaces: { id: string; github_repo?: string | null }[];
  setAttachMenuOpen: Dispatch<SetStateAction<boolean>>;
  setIsModeOpen: Dispatch<SetStateAction<boolean>>;
  setIsModelPickerOpen: Dispatch<SetStateAction<boolean>>;
};

export function useChatGithubRuntime(args: UseChatGithubRuntimeArgs) {
  const {
    sessionUserId,
    effectiveWsId,
    conversationId,
    agentsamPolicy,
    isNarrow,
    workspaces,
    setAttachMenuOpen,
    setIsModeOpen,
    setIsModelPickerOpen,
  } = args;

  const [repoDrawerOpen, setRepoDrawerOpen] = useState(false);
  const [contextHubOpen, setContextHubOpen] = useState(false);
  const [contextHubInitialLane, setContextHubInitialLane] = useState<ContextHubLane>('hub');
  const [execLane, setExecLane] = useState<ExecLane | null>(() => {
    const wid = String(effectiveWsId || '').trim();
    if (!wid) return null;
    try {
      return readDockExecLane(wid);
    } catch {
      return null;
    }
  });
  const [githubRepoContext, setGithubRepoContext] = useState<string | null>(null);
  const [githubContextActive, setGithubContextActive] = useState(false);
  /** Repo currently expanded in the file explorer (not auth-workspace github_repo). */
  const [explorerActiveRepo, setExplorerActiveRepo] = useState<string | null>(null);
  /** Live Files-rail bind — SSOT for whether this turn is local / github / r2 / …. */
  const filesSourceContextRef = useRef<AgentSamFsSourceContext | null>(null);
  const [explorerActiveSource, setExplorerActiveSource] = useState<string | null>(null);
  const explorerActiveSourceRef = useRef<string | null>(null);
  const [chatGithubFilePath, setChatGithubFilePath] = useState<string | null>(null);
  const [chatGithubBranch, setChatGithubBranch] = useState('');
  const [chatGithubFileContent, setChatGithubFileContent] = useState<string | null>(null);
  const [chatGithubContentTruncated, setChatGithubContentTruncated] = useState(false);
  const [chatGithubContentSha, setChatGithubContentSha] = useState<string | null>(null);
  const [runtimeChecks, setRuntimeChecks] = useState<
    { id: string; ok: boolean; label: string; providerKey?: string; iconSlug?: string }[]
  >([]);
  const [runtimeChecksLoading, setRuntimeChecksLoading] = useState(false);

  const refreshRuntimeChecks = useCallback(async () => {
    setRuntimeChecksLoading(true);
    const rows: { id: string; ok: boolean; label: string; providerKey?: string; iconSlug?: string }[] =
      [];
    const lane = execLane;
    try {
      const [wr, sr, gr, wg] = await Promise.all([
        fetch('/api/health', { credentials: 'same-origin' }),
        lane === 'sandbox'
          ? fetch('/api/sandbox/health', { credentials: 'same-origin' })
          : Promise.resolve(null),
        fetch('/api/mail/gmail/status', { credentials: 'same-origin' }),
        lane === 'sandbox'
          ? fetch('/api/terminal/wrangler-guide?lane=sandbox', { credentials: 'same-origin' })
          : Promise.resolve(null),
      ]);
      const wj = await wr.json().catch(() => ({}));
      rows.push({
        id: 'worker',
        ok: wr.ok && wj.status === 'ok',
        label: 'Worker',
        iconSlug: 'cloudflare',
      });
      if (sr) {
        const sj = await sr.json().catch(() => ({}));
        rows.push({
          id: 'sandbox',
          ok: sr.ok && sj.ok === true,
          label: 'CF sandbox',
          providerKey: 'cloudflare_oauth',
          iconSlug: 'cloudflare',
        });
      }
      const gj = await gr.json().catch(() => ({}));
      rows.push({
        id: 'gmail',
        ok: gr.ok && !!gj.connected,
        label: 'Gmail',
        providerKey: 'gmail',
        iconSlug: 'gmail',
      });
      if (wg) {
        const wgj = await wg.json().catch(() => ({}));
        rows.push({
          id: 'wrangler',
          ok: wg.ok && wgj.ok === true,
          label: 'Wrangler',
          providerKey: 'cloudflare_oauth',
          iconSlug: 'cloudflare',
        });
      }
    } catch {
      rows.push({ id: 'worker', ok: false, label: 'Worker', iconSlug: 'cloudflare' });
    }
    setRuntimeChecks(rows);
    setRuntimeChecksLoading(false);
  }, [execLane]);

  const saveGithubRepoSelection = useCallback(
    (
      full: string,
      filePath?: string | null,
      branch = '',
      fileMeta?: {
        content?: string | null;
        contentSha?: string | null;
        contentTruncated?: boolean;
      },
    ) => {
      setGithubContextActive(true);
      setGithubRepoContext(full);
      if (filePath !== undefined) {
        setChatGithubFilePath(filePath?.trim() || null);
        if (!filePath?.trim()) {
          setChatGithubFileContent(null);
          setChatGithubContentTruncated(false);
          setChatGithubContentSha(null);
        }
      }
      setChatGithubBranch(branch.trim());
      if (fileMeta !== undefined) {
        setChatGithubFileContent(fileMeta.content?.trim() ? fileMeta.content : null);
        setChatGithubContentTruncated(!!fileMeta.contentTruncated);
        setChatGithubContentSha(fileMeta.contentSha?.trim() || null);
      }
      const key = chatGithubContextStorageKey(sessionUserId, effectiveWsId, conversationId);
      writeChatGithubContext(key, {
        repo: full,
        path: filePath?.trim() || null,
        branch: branch.trim() || null,
        content: fileMeta?.content?.trim() || null,
        content_truncated: fileMeta?.contentTruncated ?? false,
        content_sha: fileMeta?.contentSha?.trim() || null,
      });
    },
    [sessionUserId, effectiveWsId, conversationId],
  );

  useEffect(() => {
    const handleGithubBranchContext = (event: Event) => {
      const detail = (event as CustomEvent<{ repo?: string | null; branch?: string | null }>).detail;
      const branch = detail?.branch?.trim() || '';
      if (!branch) return;
      const repo = detail?.repo?.trim() || '';
      const currentRepo = (githubRepoContext || explorerActiveRepo || '').trim();
      if (repo && currentRepo && repo !== currentRepo) return;
      const targetRepo = repo || currentRepo;
      if (!targetRepo) return;
      if (repo && !currentRepo) setGithubRepoContext(repo);
      setChatGithubBranch(branch);
      const key = chatGithubContextStorageKey(sessionUserId, effectiveWsId, conversationId);
      writeChatGithubContext(key, {
        repo: targetRepo,
        path: chatGithubFilePath,
        branch,
        content: chatGithubFileContent,
        content_truncated: chatGithubContentTruncated,
        content_sha: chatGithubContentSha,
      });
    };
    window.addEventListener('iam:github-branch-context', handleGithubBranchContext);
    return () => window.removeEventListener('iam:github-branch-context', handleGithubBranchContext);
  }, [
    conversationId,
    effectiveWsId,
    explorerActiveRepo,
    githubRepoContext,
    sessionUserId,
    chatGithubFilePath,
    chatGithubFileContent,
    chatGithubContentTruncated,
    chatGithubContentSha,
  ]);

  const openContextHub = useCallback((lane: ContextHubLane = 'hub') => {
    setContextHubInitialLane(lane);
    setContextHubOpen(true);
    setAttachMenuOpen(false);
    setIsModeOpen(false);
    setIsModelPickerOpen(false);
  }, []);

  const openRepoPicker = useCallback(() => {
    if (isNarrow) openContextHub('github');
    else setRepoDrawerOpen(true);
  }, [isNarrow, openContextHub]);

  const handleExecLaneChange = useCallback((lane: ExecLane) => {
    const wid = String(effectiveWsId || '').trim();
    if (!wid) return;
    setExecLane(lane);
    writeDockExecLane(lane, wid);
  }, [effectiveWsId]);

  useEffect(() => {
    const wid = String(effectiveWsId || '').trim();
    if (!wid) {
      setExecLane(null);
      return;
    }
    try {
      setExecLane(readDockExecLane(wid));
    } catch {
      setExecLane(null);
    }
  }, [effectiveWsId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Live explorer events — authoritative for "where you are" (repo + Files plane).
    const onExplorerRepo = (ev: Event) => {
      const detail = (ev as CustomEvent<{ active_repo?: string | null }>).detail;
      const repo = detail?.active_repo != null ? String(detail.active_repo).trim() : '';
      setExplorerActiveRepo(repo || null);
    };
    const onExplorerSource = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        source?: string | null;
        github_repo?: string | null;
      }>).detail;
      const source = String(detail?.source || '')
        .trim()
        .toLowerCase();
      if (!source) return;
      setExplorerActiveSource(source);
      explorerActiveSourceRef.current = source;
      if (source !== 'github') {
        // Left the GitHub plane — drop repo so send path cannot invent github.
        setGithubContextActive(false);
        setExplorerActiveRepo(null);
        setGithubRepoContext(null);
        setChatGithubFilePath(null);
        setChatGithubFileContent(null);
        setChatGithubContentTruncated(false);
        setChatGithubContentSha(null);
        return;
      }
      const gh = detail?.github_repo != null ? String(detail.github_repo).trim() : '';
      if (gh) {
        setGithubContextActive(true);
        setExplorerActiveRepo(gh);
        setGithubRepoContext(gh);
      }
    };

    // filesCtx blob — path/handle metadata only. Repo/source authority is iam_explorer_*.
    const onFilesContext = (ev: Event) => {
      const detail = (ev as CustomEvent<AgentSamFsSourceContext>).detail;
      if (!detail?.source) return;
      filesSourceContextRef.current = detail;
      // Mount race: seed source once if explorer events have not landed yet.
      if (!explorerActiveSourceRef.current) {
        setExplorerActiveSource(detail.source);
        explorerActiveSourceRef.current = detail.source;
        if (detail.source === 'github' && detail.github_repo?.trim()) {
          setGithubContextActive(true);
          setExplorerActiveRepo(detail.github_repo.trim());
          setGithubRepoContext(detail.github_repo.trim());
        }
      }
    };

    window.addEventListener('iam_explorer_active_repo', onExplorerRepo);
    window.addEventListener('iam_explorer_active_source', onExplorerSource);
    window.addEventListener(IAM_FILES_SOURCE_CONTEXT_EVENT, onFilesContext);
    try {
      window.dispatchEvent(new CustomEvent('iam_explorer_request_active_repo'));
      window.dispatchEvent(new CustomEvent(IAM_FILES_SOURCE_CONTEXT_REQUEST_EVENT));
    } catch {
      /* ignore */
    }
    return () => {
      window.removeEventListener('iam_explorer_active_repo', onExplorerRepo);
      window.removeEventListener('iam_explorer_active_source', onExplorerSource);
      window.removeEventListener(IAM_FILES_SOURCE_CONTEXT_EVENT, onFilesContext);
    };
  }, []);

  useEffect(() => {
    // When Files rail already declared a non-GitHub source, do not invent github from D1/storage.
    const filesSrc = filesSourceContextRef.current?.source;
    if (filesSrc && filesSrc !== 'github') {
      return;
    }
    const convId = conversationId.trim();
    if (convId) {
      const draftKey = chatGithubContextStorageKey(sessionUserId, effectiveWsId, 'draft');
      const chatKey = chatGithubContextStorageKey(sessionUserId, effectiveWsId, convId);
      const draft = readChatGithubContext(draftKey);
      const existing = readChatGithubContext(chatKey);
      if (draft?.repo && !existing?.repo) {
        writeChatGithubContext(chatKey, draft);
      }
    }
    const chatKey = chatGithubContextStorageKey(sessionUserId, effectiveWsId, conversationId);
    const chatCtx = readChatGithubContext(chatKey);
    let ctx = chatCtx;
    if (!ctx?.repo && effectiveWsId) {
      const legacyKey = githubRepoContextStorageKey(sessionUserId, effectiveWsId);
      ctx = readChatGithubContext(legacyKey);
    }
    // Do not seed chat github from workspaces.github_repo — that forced mobile into a
    // repo context for ordinary chats. Only Files rail / per-chat storage may set it.
    if (filesSrc === 'github') {
      const repoFallback =
        ctx?.repo?.trim() || filesSourceContextRef.current?.github_repo || null;
      setGithubContextActive(Boolean(repoFallback));
      setGithubRepoContext(repoFallback);
      setChatGithubFilePath(ctx?.path?.trim() || null);
      setChatGithubBranch(ctx?.branch?.trim() || '');
      setChatGithubFileContent(ctx?.content?.trim() || null);
      setChatGithubContentTruncated(!!ctx?.content_truncated);
      setChatGithubContentSha(ctx?.content_sha?.trim() || null);
    } else if (!filesSrc) {
      // No Files source yet: only an explicit per-chat pick is active. A legacy remembered
      // repo can still prefill the + drawer, but it must not light the composer or send.
      setGithubContextActive(Boolean(chatCtx?.repo?.trim()));
      setGithubRepoContext(ctx?.repo?.trim() || null);
      setChatGithubFilePath(ctx?.path?.trim() || null);
      setChatGithubBranch(ctx?.branch?.trim() || '');
      setChatGithubFileContent(ctx?.content?.trim() || null);
      setChatGithubContentTruncated(!!ctx?.content_truncated);
      setChatGithubContentSha(ctx?.content_sha?.trim() || null);
    }
  }, [sessionUserId, effectiveWsId, conversationId, workspaces]);

  const clearGithubState = useCallback(() => {
    setGithubContextActive(false);
    setGithubRepoContext(null);
    setChatGithubFilePath(null);
    setChatGithubBranch('');
    setChatGithubFileContent(null);
    setChatGithubContentTruncated(false);
    setChatGithubContentSha(null);
    try {
      localStorage.removeItem(chatGithubContextStorageKey(sessionUserId, effectiveWsId, conversationId));
    } catch {
      /* ignore */
    }
  }, [sessionUserId, effectiveWsId, conversationId]);

  return {
    repoDrawerOpen,
    setRepoDrawerOpen,
    contextHubOpen,
    setContextHubOpen,
    contextHubInitialLane,
    setContextHubInitialLane,
    execLane,
    setExecLane,
    githubRepoContext,
    githubContextActive,
    setGithubRepoContext,
    explorerActiveRepo,
    filesSourceContextRef,
    explorerActiveSource,
    explorerActiveSourceRef,
    chatGithubFilePath,
    chatGithubBranch,
    chatGithubFileContent,
    chatGithubContentTruncated,
    chatGithubContentSha,
    runtimeChecks,
    runtimeChecksLoading,
    refreshRuntimeChecks,
    saveGithubRepoSelection,
    openContextHub,
    openRepoPicker,
    handleExecLaneChange,
    clearGithubState,
  };
}
