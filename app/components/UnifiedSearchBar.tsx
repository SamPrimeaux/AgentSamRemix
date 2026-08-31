import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FolderSearch, Router, Search } from 'lucide-react';
import { resumeAgentChatSession } from '../lib/openAgentConversation';
import { SetiFileIcon } from '../src/components/SetiFileIcon';
import {
  WRANGLER_CATEGORY_LABELS,
  groupWranglerCatalog,
} from '../lib/wranglerCommandCatalog';
import { useWorkspace } from '../src/context/WorkspaceContext';
import {
  databaseStudioPathFromName,
  expectedDatabaseNameForWorkspace,
  expectedR2BucketForWorkspace,
  isPlatformWorkspace,
} from '../src/lib/databaseStudioRoute';
import { ConnectionMenuPanel, type ConnectionMenuAction } from './ConnectionMenuPanel';
import { GitRepoBranchMenuPanel, GitRepoBranchNavTrigger } from './GitRepoBranchDropdown';
import { SHELL_DROPDOWN_WIDTH_PX } from './ShellDropdownPanel';
import { filterDeployPaletteRows } from '../src/lib/deployPaletteItems';
import { IAM_GIT_SYNC_PUBLISH, IAM_OPEN_CONNECTION_MENU, IAM_OPEN_GIT_REPO_MENU } from '../src/lib/openCommandPalette';
import type { OpenCommandPaletteDetail } from '../src/lib/openCommandPalette';
import { parseGithubCloneRef } from '../src/lib/githubClone';
import {
  PALETTE_CONNECT_CLOUDFLARE,
  PALETTE_R2_PAGE_SIZE,
  fetchPaletteCloudflareCatalog,
  fetchPaletteD1Databases,
  fetchPaletteHyperdriveConfigs,
  fetchPaletteR2Buckets,
  fetchPaletteVectorizeIndexes,
  filterPaletteR2Buckets,
  probePaletteCloudflareConnected,
  type PaletteCfCatalog,
} from '../src/lib/paletteCloudflare';
import { searchConnectedLocalFiles } from '../src/lib/searchConnectedLocalFiles';
import { searchConnectedLocalContent } from '../src/lib/searchConnectedLocalContent';
import {
  CommandPaletteShell,
  type CommandPaletteGroup as KumoCommandPaletteGroup,
} from '@iam/cms-template-library';

import {
  QUICK_OPEN_ACTIONS,
  SOURCE_CHIPS,
  buildPlaneSectionsFromCatalog,
  catalogEntryToPalette,
  chipMatchesCategory,
  deployRowToPalette,
  d1RowsToPalette,
  fetchJson,
  legacyToPalette,
  hyperdriveRowsToPalette,
  mergeCommandCatalog,
  normalizeLegacySearchRows,
  paletteSearchTips,
  parseQueryMode,
  r2CatalogToPaletteItems,
  rowIcon,
  sectionTitle,
  vectorizeRowsToPalette,
  type CommandSection,
  type GithubRepoListRow,
  type LegacyUnifiedRow,
  type PaletteItem,
  type SourceChipId,
  type UnifiedSearchNavigate,
} from './unified-search/paletteModel';
export type { UnifiedSearchNavigate } from './unified-search/paletteModel';

export const UnifiedSearchBar: React.FC<{
  workspaceLabel?: string;
  /** Mobile (≤430px): search-only trigger — no workspace chip in top bar on any route. */
  hideWorkspaceSegment?: boolean;
  /** Mobile top-bar right cluster: anchor palette to the right edge. */
  mobileToolbar?: boolean;
  onWorkspacePickerClick?: () => void;
  /** Opens global repo/branch menu (rendered by App shell). */
  onGitRepoMenuOpen?: () => void;
  gitBranch?: string;
  activeWorkspaceId?: string | null;
  workspaceRepoHint?: string | null;
  onGitBranchSelect?: (branch: string) => void;
  onGitBranchPanelClick?: () => void;
  onOpenCommandPalette?: (detail?: OpenCommandPaletteDetail) => void;
  recentFiles?: { name: string; path: string; label?: string }[];
  onNavigate: (nav: UnifiedSearchNavigate, searchQuery: string) => void;
  onRunCommand?: (cmd: string) => void;
  controlledOpen?: boolean;
  onControlledOpenChange?: (open: boolean) => void;
  initialFacets?: string[];
  initialQuery?: string;
  onInitialQueryConsumed?: () => void;
  /** When true, this instance owns StatusBar-triggered git/connection dropdowns (one per viewport). */
  shellDropdownHost?: boolean;
  onConnectionMenuAction?: (action: ConnectionMenuAction) => void;
}> = ({
  workspaceLabel,
  hideWorkspaceSegment = false,
  mobileToolbar = false,
  onWorkspacePickerClick,
  onGitRepoMenuOpen,
  gitBranch,
  activeWorkspaceId,
  workspaceRepoHint,
  onGitBranchSelect,
  onGitBranchPanelClick,
  onOpenCommandPalette,
  recentFiles = [],
  onNavigate,
  onRunCommand: _onRunCommand,
  controlledOpen,
  onControlledOpenChange,
  initialFacets,
  initialQuery,
  onInitialQueryConsumed,
  shellDropdownHost = false,
  onConnectionMenuAction,
}) => {
  const navigate = useNavigate();
  const { workspaceId, workspaces } = useWorkspace();
  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );
  const collabDbName = expectedDatabaseNameForWorkspace(activeWorkspace);
  const collabR2Bucket = expectedR2BucketForWorkspace(activeWorkspace);

  const workspaceFetchInit = useCallback(
    (init?: RequestInit): RequestInit => {
      const headers: Record<string, string> = {
        ...((init?.headers as Record<string, string> | undefined) || {}),
      };
      const ws = workspaceId?.trim();
      if (ws) headers['X-IAM-Workspace-Id'] = ws;
      if (collabDbName) headers['X-IAM-Database-Name'] = collabDbName;
      return { ...init, headers };
    },
    [workspaceId, collabDbName],
  );

  const workspaceFetchJson = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T | null> => {
      try {
        const res = await fetch(url, { credentials: 'same-origin', ...workspaceFetchInit(init) });
        if (!res.ok) return null;
        return (await res.json()) as T;
      } catch {
        return null;
      }
    },
    [workspaceFetchInit],
  );

  const isControlled = controlledOpen !== undefined;
  const [localOpen, setLocalOpen] = useState(false);
  const open = isControlled ? controlledOpen : localOpen;
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    if (isControlled) onControlledOpenChange?.(next);
    else setLocalOpen(next);
  };

  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [recentSearches, setRecentSearches] = useState<PaletteItem[]>([]);
  const [sourceChip, setSourceChip] = useState<SourceChipId>('all');
  const [cfConnected, setCfConnected] = useState<boolean | null>(null);
  const [r2Catalog, setR2Catalog] = useState<{ name: string; bound: boolean }[]>([]);
  const [r2Page, setR2Page] = useState(1);
  const [commandSections, setCommandSections] = useState<CommandSection[]>([]);
  const [planeSections, setPlaneSections] = useState<CommandSection[]>([]);
  const [planesCatalog, setPlanesCatalog] = useState<PaletteCfCatalog | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [bucketMenuOpen, setBucketMenuOpen] = useState(false);
  const [bucketMenuRows, setBucketMenuRows] = useState<{ name: string; bound: boolean }[]>([]);
  const [bucketMenuLoading, setBucketMenuLoading] = useState(false);
  const bucketMenuRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const githubReposCacheRef = useRef<GithubRepoListRow[] | null>(null);
  const githubReposAuthedRef = useRef<boolean | null>(null);
  const [connectionMenuOpen, setConnectionMenuOpen] = useState(false);
  const [gitMenuOpen, setGitMenuOpen] = useState(false);
  const connectionMenuRef = useRef<HTMLDivElement>(null);
  const gitMenuRef = useRef<HTMLDivElement>(null);

  const { mode, term } = useMemo(() => parseQueryMode(q), [q]);

  const activeChip = useMemo((): SourceChipId => {
    if (mode === 'file') return 'files';
    if (mode === 'r2') return 'r2';
    if (mode === 'd1') return 'd1';
    if (mode === 'planes' || mode === 'hyperdrive' || mode === 'vectorize') return 'planes';
    return sourceChip;
  }, [mode, sourceChip]);

  useEffect(() => {
    if (!open) {
      githubReposCacheRef.current = null;
      githubReposAuthedRef.current = null;
    }
  }, [open]);

  const activateDataPlaneChip = useCallback((chip: SourceChipId, prefix: string) => {
    setSourceChip(chip);
    setQ(prefix);
    setPlaneSections([]);
    setCommandSections([]);
  }, []);

  const openFilesSearch = useCallback(() => {
    setGitMenuOpen(false);
    setConnectionMenuOpen(false);
    setSourceChip('all');
    setQ('');
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (initialQuery) {
      setQ(initialQuery);
      onInitialQueryConsumed?.();
    }
    if (initialFacets?.length) {
      const map: Record<string, SourceChipId> = {
        d1: 'd1',
        commands: 'commands',
        deploy: 'commands',
        codebase: 'all',
        scripts: 'commands',
        files: 'files',
        file: 'files',
      };
      const first = initialFacets.map((f) => map[f]).find(Boolean);
      if (first) setSourceChip(first);
      if (initialFacets.includes('deploy') && !initialQuery) {
        setQ('deploy');
      }
      if ((initialFacets.includes('files') || initialFacets.includes('file')) && !initialQuery) {
        setQ('@');
      }
    }
  }, [open, initialFacets, initialQuery, onInitialQueryConsumed]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadDefault = useCallback(async () => {
    // File-first Quick Open home: actions + recent files (no chat/deploy dump).
    setLoading(true);
    setCommandSections([]);
    setPlaneSections([]);
    try {
      const recent: PaletteItem[] = recentFiles.slice(0, 12).map((f) => ({
        id: `file-recent-${f.path}`,
        category: 'file' as const,
        title: f.name,
        subtitle: f.label || f.path,
        filePath: f.path,
      }));

      let connected: PaletteItem[] = [];
      try {
        const { hits, connected: isConnected, permission } = await searchConnectedLocalFiles('');
        if (isConnected && (permission === 'granted' || permission === 'unsupported')) {
          connected = hits.slice(0, 8).map((h) => ({
            id: `file-fsa-${h.path}`,
            category: 'file' as const,
            title: h.name,
            subtitle: `${h.rootName}/${h.path}`,
            filePath: h.path,
          }));
        }
      } catch {
        /* ignore */
      }

      const seen = new Set<string>();
      const files: PaletteItem[] = [];
      for (const row of [...recent, ...connected]) {
        const key = row.filePath || row.title;
        if (seen.has(key)) continue;
        seen.add(key);
        files.push(row);
      }

      // Tips + files; displaySections splits them for Quick Open layout.
      setItems([...QUICK_OPEN_ACTIONS, ...files]);
      setRecentSearches([]);
    } finally {
      setLoading(false);
    }
  }, [recentFiles]);

  const loadR2 = useCallback(async (searchTerm: string) => {
    setLoading(true);
    try {
      setPlaneSections([]);
      const connected = await probePaletteCloudflareConnected(workspaceFetchInit);
      setCfConnected(connected);
      if (!connected) {
        setR2Catalog([]);
        setR2Page(1);
        setItems([{ ...PALETTE_CONNECT_CLOUDFLARE }]);
        return;
      }
      const rows = await fetchPaletteR2Buckets(workspaceFetchInit, activeWorkspace);
      const sorted = filterPaletteR2Buckets(rows, searchTerm);
      setR2Catalog(sorted);
      setR2Page(1);
      setItems(r2CatalogToPaletteItems(sorted.slice(0, PALETTE_R2_PAGE_SIZE)));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, workspaceFetchInit]);

  const loadD1 = useCallback(async (searchTerm: string) => {
    setLoading(true);
    try {
      setPlaneSections([]);
      const connected = await probePaletteCloudflareConnected(workspaceFetchInit);
      setCfConnected(connected);
      if (!connected) {
        setItems([{ ...PALETTE_CONNECT_CLOUDFLARE }]);
        return;
      }
      const databases = await fetchPaletteD1Databases(workspaceFetchInit);
      const filtered = searchTerm
        ? databases.filter((db) => db.name.toLowerCase().includes(searchTerm.toLowerCase()))
        : databases;
      setItems(
        d1RowsToPalette(filtered),
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceFetchInit]);

  const loadHyperdrive = useCallback(async (searchTerm: string) => {
    setLoading(true);
    try {
      setPlaneSections([]);
      const connected = await probePaletteCloudflareConnected(workspaceFetchInit);
      setCfConnected(connected);
      if (!connected) {
        setItems([{ ...PALETTE_CONNECT_CLOUDFLARE }]);
        return;
      }
      const configs = await fetchPaletteHyperdriveConfigs(workspaceFetchInit);
      const term = searchTerm.trim().toLowerCase();
      const filtered = term
        ? configs.filter((c) => `${c.name} ${c.id}`.toLowerCase().includes(term))
        : configs;
      setItems(hyperdriveRowsToPalette(filtered));
    } finally {
      setLoading(false);
    }
  }, [workspaceFetchInit]);

  const loadVectorize = useCallback(async (searchTerm: string) => {
    setLoading(true);
    try {
      setPlaneSections([]);
      const connected = await probePaletteCloudflareConnected(workspaceFetchInit);
      setCfConnected(connected);
      if (!connected) {
        setItems([{ ...PALETTE_CONNECT_CLOUDFLARE }]);
        return;
      }
      const indexes = await fetchPaletteVectorizeIndexes(workspaceFetchInit);
      const term = searchTerm.trim().toLowerCase();
      const filtered = term
        ? indexes.filter((i) => `${i.name} ${i.description || ''}`.toLowerCase().includes(term))
        : indexes;
      setItems(vectorizeRowsToPalette(filtered));
    } finally {
      setLoading(false);
    }
  }, [workspaceFetchInit]);

  const loadPlanes = useCallback(async (searchTerm: string, page = 1) => {
    setLoading(true);
    try {
      setCommandSections([]);
      if (!workspaceId?.trim()) {
        setPlaneSections([]);
        setItems([
          {
            id: 'workspace-required',
            category: 'connect',
            title: 'Select a workspace',
            subtitle: 'Choose a workspace to browse your Cloudflare data planes',
          },
        ]);
        return;
      }
      const connected = await probePaletteCloudflareConnected(workspaceFetchInit);
      setCfConnected(connected);
      if (!connected) {
        setPlaneSections([]);
        setR2Catalog([]);
        setR2Page(1);
        setItems([{ ...PALETTE_CONNECT_CLOUDFLARE }]);
        return;
      }
      const catalog = await fetchPaletteCloudflareCatalog(workspaceFetchInit);
      if (!catalog?.ok) {
        setPlaneSections([]);
        setPlanesCatalog(null);
        setItems([{ ...PALETTE_CONNECT_CLOUDFLARE }]);
        return;
      }
      setPlanesCatalog(catalog);
      const built = buildPlaneSectionsFromCatalog(catalog, searchTerm, page);
      setR2Catalog(built.r2Catalog);
      setR2Page(page);
      setPlaneSections(built.sections);
      setItems(built.sections.flatMap((s) => s.rows));
    } finally {
      setLoading(false);
    }
  }, [workspaceFetchInit, workspaceId]);

  const loadCommands = useCallback(async (searchTerm: string) => {
    setLoading(true);
    try {
      const chipCategory =
        sourceChip === 'r2'
          ? 'r2'
          : sourceChip === 'd1'
            ? 'd1'
            : sourceChip === 'workflows'
              ? 'workflows'
              : '';
      const qs = new URLSearchParams({ limit: '80' });
      if (searchTerm) qs.set('q', searchTerm);
      if (chipCategory && chipCategory !== 'workflows') qs.set('category', chipCategory);

      const primary = await fetchJson<{ commands?: Record<string, unknown>[] }>(`/api/commands?${qs}`);
      const apiRows = Array.isArray(primary?.commands) ? primary.commands : [];

      const merged = mergeCommandCatalog(apiRows, searchTerm, 80);
      const deployRows = filterDeployPaletteRows(searchTerm).map(deployRowToPalette);
      const grouped = groupWranglerCatalog(merged);
      const sections: CommandSection[] = [];
      if (deployRows.length > 0) {
        sections.push({ key: 'deploy', label: 'Deploy', rows: deployRows });
      }
      for (const g of grouped) {
        sections.push({
          key: g.category,
          label: g.label,
          rows: g.rows.map(catalogEntryToPalette),
        });
      }

      setCommandSections(sections);
      setItems(sections.flatMap((s) => s.rows));
    } finally {
      setLoading(false);
    }
  }, [sourceChip]);

  const loadWorkflows = useCallback(async (searchTerm: string) => {
    setLoading(true);
    try {
      let rows: {
        id?: string;
        workflow_key?: string;
        display_name?: string;
        status?: string;
        created_at?: string | number | null;
        description?: string;
      }[] = [];

      const qs = new URLSearchParams({ limit: '10' });
      if (searchTerm) qs.set('q', searchTerm);
      const ws = workspaceId?.trim();
      if (ws) qs.set('workspace_id', ws);

      const primary = await workspaceFetchJson<typeof rows | { workflows?: typeof rows }>(
        `/api/workflows?${qs}`,
      );
      if (Array.isArray(primary)) rows = primary;
      else if (primary && typeof primary === 'object' && Array.isArray((primary as { workflows?: typeof rows }).workflows)) {
        rows = (primary as { workflows: typeof rows }).workflows;
      }

      if (!rows.length) {
        const fallback = await workspaceFetchJson<typeof rows>('/api/agentsam/workflows');
        if (Array.isArray(fallback)) rows = fallback;
      }

      const filtered = rows
        .filter((w) => {
          if (!searchTerm) return true;
          const hay = `${w.workflow_key || ''} ${w.display_name || ''} ${w.description || ''}`.toLowerCase();
          return hay.includes(searchTerm.toLowerCase());
        })
        .slice(0, 10);

      setItems(
        filtered.map((w) => ({
          id: `wf-${w.id || w.workflow_key}`,
          category: 'workflow',
          title: String(w.display_name || w.workflow_key || 'Workflow'),
          subtitle:
            w.workflow_key
            || [w.status ? String(w.status) : '', w.created_at != null ? String(w.created_at) : ''].filter(Boolean).join(' · ')
            || w.description
            || undefined,
          workflowKey: String(w.workflow_key || w.id || ''),
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId, workspaceFetchJson]);

  const loadFiles = useCallback(
    async (searchTerm: string) => {
      setLoading(true);
      try {
        const local: PaletteItem[] = recentFiles
          .filter((f) => !searchTerm || `${f.name} ${f.path}`.toLowerCase().includes(searchTerm.toLowerCase()))
          .slice(0, 8)
          .map((f) => ({
            id: `file-local-${f.path}`,
            category: 'file',
            title: f.name,
            subtitle: f.label || f.path,
            filePath: f.path,
          }));

        let connected: PaletteItem[] = [];
        try {
          const { hits, connected: isConnected, permission } = await searchConnectedLocalFiles(searchTerm);
          if (!isConnected) {
            connected = [
              {
                id: 'file-connect-hint',
                category: 'tip',
                title: 'Connect a local folder',
                subtitle: 'Use Local folder in the workspace to search package.json and more',
              },
            ];
          } else if (permission === 'prompt' || permission === 'denied') {
            connected = [
              {
                id: 'file-perm-hint',
                category: 'tip',
                title: 'Reconnect local folder',
                subtitle: 'Files panel shows Disconnected — grant access to search this machine',
              },
            ];
          } else {
            connected = hits.map((h) => ({
              id: `file-fsa-${h.path}`,
              category: 'file' as const,
              title: h.name,
              subtitle: `${h.rootName}/${h.path}`,
              filePath: h.path,
            }));
          }
        } catch {
          /* ignore FSA errors */
        }

        let remote: PaletteItem[] = [];
        if (searchTerm.length >= 2) {
          const res = await fetch('/api/unified-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ query: searchTerm, limit: 12, source_filters: ['codebase'] }),
          });
          const data = res.ok ? await res.json() : {};
          remote = normalizeLegacySearchRows(data as Record<string, unknown>)
            .filter((r) => r.type === 'knowledge' || r.type === 'file')
            .map((r) => legacyToPalette(r))
            .filter((x): x is PaletteItem => !!x)
            .map((r) => ({ ...r, category: 'file' as const, filePath: r.legacyRow?.url || r.title }));
        }

        const seen = new Set<string>();
        const merged: PaletteItem[] = [];
        for (const row of [...connected, ...local, ...remote]) {
          const key = `${row.category}:${row.filePath || row.title}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(row);
        }
        setItems(merged);
      } finally {
        setLoading(false);
      }
    },
    [recentFiles],
  );

  /** `#` — real workspace text search (FSA). Falls back to unified-search when disconnected. */
  const loadContentSearch = useCallback(async (searchTerm: string) => {
    setLoading(true);
    setCommandSections([]);
    try {
      const term = searchTerm.trim();
      if (term.length < 2) {
        setItems([
          {
            id: 'content-hint',
            category: 'tip',
            title: '#',
            subtitle: 'Type at least 2 characters to search file contents',
          },
        ]);
        return;
      }

      // Show an explicit loading row immediately — the FSA + remote search below
      // can take a moment, and until now the results panel stayed blank/frozen
      // during that window (looked like "nothing happens").
      setItems([
        {
          id: 'content-searching',
          category: 'tip',
          title: 'Searching…',
          subtitle: `Looking for "${term.slice(0, 40)}" in connected files and knowledge`,
        },
      ]);

      const localHits: PaletteItem[] = [];
      try {
        const { hits, connected, permission } = await searchConnectedLocalContent(term);
        if (!connected) {
          localHits.push({
            id: 'content-connect',
            category: 'tip',
            title: 'Connect a local folder',
            subtitle: 'Use Local folder so # can search file contents on this machine',
          });
        } else if (permission === 'prompt' || permission === 'denied') {
          localHits.push({
            id: 'content-perm',
            category: 'tip',
            title: 'Reconnect local folder',
            subtitle: 'Files panel shows Disconnected — grant access to search contents',
          });
        } else if (!hits.length) {
          localHits.push({
            id: 'content-empty',
            category: 'tip',
            title: `No matches for “${term.slice(0, 40)}”`,
            subtitle: 'Searched connected folder text files',
          });
        } else {
          for (const h of hits) {
            localHits.push({
              id: `content-${h.path}:${h.line}:${h.column}`,
              category: 'file',
              title: h.name,
              subtitle: `${h.path}:${h.line} · ${h.preview}`,
              filePath: h.path,
              fileLine: h.line,
              fileColumn: h.column,
            });
          }
        }
      } catch {
        /* ignore FSA errors */
      }

      let remote: PaletteItem[] = [];
      if (term.length >= 2) {
        try {
          const res = await fetch('/api/unified-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ query: term, limit: 10, source_filters: ['codebase'] }),
          });
          if (res.ok) {
            remote = normalizeLegacySearchRows((await res.json()) as Record<string, unknown>)
              .filter((r) => r.type === 'knowledge' || r.type === 'file')
              .map((r) => legacyToPalette(r))
              .filter((x): x is PaletteItem => !!x)
              .map((r) => ({
                ...r,
                category: 'file' as const,
                filePath: r.legacyRow?.url || r.title,
                subtitle: r.subtitle ? `${r.subtitle} · knowledge` : 'knowledge',
              }));
          }
        } catch {
          /* ignore */
        }
      }

      const fileHits = localHits.filter((i) => i.category === 'file');
      const tips = localHits.filter((i) => i.category === 'tip');
      setItems(fileHits.length ? [...fileHits, ...remote] : [...tips, ...remote]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadClone = useCallback(
    async (searchTerm: string) => {
      setLoading(true);
      try {
        const needle = searchTerm.trim().toLowerCase();
        const explicitRef = needle ? parseGithubCloneRef(searchTerm) : null;

        let repos = githubReposCacheRef.current;
        let authed = githubReposAuthedRef.current;

        if (repos === null) {
          const hdr: Record<string, string> = {};
          if (workspaceId?.trim()) hdr['X-IAM-Workspace-Id'] = workspaceId.trim();
          const res = await fetch('/api/integrations/github/repos', {
            credentials: 'same-origin',
            headers: hdr,
          });
          authed = res.ok;
          githubReposAuthedRef.current = authed;
          if (!res.ok) {
            repos = [];
            githubReposCacheRef.current = repos;
          } else {
            const data: unknown = await res.json();
            const list = Array.isArray(data)
              ? data
              : data && typeof data === 'object' && 'repos' in data
                ? (data as { repos?: unknown }).repos ?? []
                : [];
            repos = (Array.isArray(list) ? list : [])
              .filter((r: GithubRepoListRow) => r.full_name || r.name);
            githubReposCacheRef.current = repos;
          }
        }

        if (!authed) {
          setItems([
            {
              id: 'clone-hint',
              category: 'tip',
              title: needle
                ? `Clone ${searchTerm.trim()} — connect GitHub to browse your repos`
                : 'Type owner/repo or paste a GitHub URL',
              subtitle: 'Connect GitHub to list repos for your signed-in account',
            },
            {
              id: 'clone-connect',
              category: 'connect',
              title: 'Connect GitHub',
              subtitle: 'Integrations → GitHub OAuth',
            },
          ]);
          return;
        }

        const filtered = needle
          ? repos!.filter((r) => {
              const fn = (r.full_name || r.name || '').toLowerCase();
              return fn.includes(needle) || fn.replace('/', ' ').includes(needle);
            })
          : repos!;

        const rows: PaletteItem[] = filtered.slice(0, 30).map((r) => {
          const ref = r.full_name || r.name || '';
          return {
            id: `github-clone-suggest-${ref}`,
            category: 'github_clone' as const,
            title: `Clone ${ref}`,
            subtitle: r.private ? 'Private · your GitHub' : r.html_url || 'Your GitHub repo',
            cloneRef: ref,
          };
        });

        if (explicitRef && !rows.some((i) => i.cloneRef === explicitRef)) {
          rows.unshift({
            id: `github-clone-${explicitRef}`,
            category: 'github_clone',
            title: `Clone ${explicitRef}`,
            subtitle: 'Git clone on your connected terminal lane · binds workspace_root',
            cloneRef: explicitRef,
          });
        }

        if (!rows.length) {
          setItems([
            {
              id: 'clone-hint',
              category: 'tip',
              title: needle ? `No repos match “${searchTerm.trim()}”` : 'No repos returned',
              subtitle: 'Type owner/repo or paste a GitHub URL',
            },
          ]);
          return;
        }

        const accountLogin = rows[0]?.cloneRef?.split('/')[0];
        if (!needle && accountLogin) {
          rows.unshift({
            id: 'clone-account-hint',
            category: 'tip',
            title: `clone ${accountLogin}/`,
            subtitle: `${filtered.length} repos · pick one below or type to filter`,
          });
        }

        setItems(rows);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId],
  );

  const runGithubClone = useCallback(
    async (raw: string) => {
      const ref = parseGithubCloneRef(raw);
      if (!ref || cloneBusy) return;
      setCloneBusy(true);
      setLoading(true);
      try {
        const res = await fetch('/api/agent/git/clone', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            ...(workspaceId?.trim() ? { 'X-IAM-Workspace-Id': workspaceId.trim() } : {}),
          },
          body: JSON.stringify({ repo: ref, workspace_id: workspaceId?.trim() || undefined }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          repo_path?: string;
          github_repo?: string;
          body?: { user_message?: string };
        };
        if (!res.ok || !data.ok) {
          const msg =
            data.body?.user_message ||
            (data.error === 'github_not_connected'
              ? 'Connect GitHub in Integrations first.'
              : data.error === 'terminal_unavailable'
                ? 'Connect Local or Cloud terminal, then retry.'
                : data.error === 'path_exists'
                  ? `Path already exists: ${data.repo_path || ref}`
                  : data.error || `Clone failed (${res.status})`);
          setToast(msg);
          return;
        }
        setToast(`Cloned ${data.github_repo || ref} → ${data.repo_path || 'workspace'}`);
        window.dispatchEvent(
          new CustomEvent('iam_workspace_github_repo', {
            detail: { workspaceId: workspaceId?.trim() || null, github_repo: data.github_repo || ref },
          }),
        );
        setOpen(false);
        setQ('');
        setItems([]);
        navigate('/dashboard/agent/editor');
      } catch (e) {
        setToast(e instanceof Error ? e.message : 'Clone failed');
      } finally {
        setCloneBusy(false);
        setLoading(false);
      }
    },
    [cloneBusy, workspaceId, navigate, setOpen],
  );

  const loadUnifiedSearch = useCallback(
    async (searchTerm: string, chip: SourceChipId) => {
      setLoading(true);
      try {
        const sourceMap: Record<SourceChipId, string[] | undefined> = {
          all: undefined,
          files: ['codebase'],
          r2: ['codebase'],
          d1: ['d1'],
          commands: ['commands'],
          workflows: ['codebase'],
          chats: ['memory'],
          planes: undefined,
        };
        const filters = sourceMap[chip];

        let legacy: LegacyUnifiedRow[] = [];
        const getUrl = `/api/unified-search?q=${encodeURIComponent(searchTerm)}&sources=all`;
        const getRes = await fetch(getUrl, { credentials: 'same-origin' });
        if (getRes.ok) {
          legacy = normalizeLegacySearchRows((await getRes.json()) as Record<string, unknown>);
        } else {
          const res = await fetch('/api/unified-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              query: searchTerm,
              limit: 24,
              ...(filters ? { source_filters: filters } : {}),
            }),
          });
          if (res.ok) legacy = normalizeLegacySearchRows((await res.json()) as Record<string, unknown>);
        }

        const palette = legacy.map(legacyToPalette).filter((x): x is PaletteItem => !!x);
        if (chip === 'all') {
          setItems(palette);
          return;
        }
        setItems(palette.filter((p) => chipMatchesCategory(chip, p.category)));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const runQuery = useCallback(async () => {
    if (mode === 'default') {
      if (q.trim() === '?') {
        setItems([
          { id: 'tip-planes', category: 'tip', title: 'planes:', subtitle: 'D1, R2, Hyperdrive & Vectorize' },
          { id: 'tip-r2', category: 'tip', title: 'r2:', subtitle: 'Search R2 buckets' },
          { id: 'tip-d1', category: 'tip', title: 'd1:', subtitle: 'List D1 databases' },
          { id: 'tip-hd', category: 'tip', title: 'hyperdrive:', subtitle: 'List Hyperdrive configs' },
          { id: 'tip-vx', category: 'tip', title: 'vectorize:', subtitle: 'List Vectorize indexes' },
          { id: 'tip-wf', category: 'tip', title: 'wf:', subtitle: 'Workflows' },
          { id: 'tip-cmd', category: 'tip', title: '/', subtitle: 'Show and run commands' },
          { id: 'tip-hash', category: 'tip', title: '#', subtitle: 'Search for text' },
          { id: 'tip-at', category: 'tip', title: '@', subtitle: 'Go to file' },
        ]);
        setLoading(false);
        return;
      }
      if (sourceChip === 'files') {
        await loadFiles('');
        return;
      }
      if (sourceChip === 'commands') {
        await loadCommands('');
        return;
      }
      if (sourceChip === 'r2') {
        await loadR2('');
        return;
      }
      if (sourceChip === 'd1') {
        await loadD1('');
        return;
      }
      if (sourceChip === 'planes') {
        await loadPlanes('', 1);
        return;
      }
      if (sourceChip === 'chats' || sourceChip === 'workflows') {
        // Power chips still use unified search empty hints via tip list
        await loadDefault();
        return;
      }
      setCommandSections([]);
      await loadDefault();
      return;
    }
    if (mode === 'r2') {
      await loadR2(term);
      return;
    }
    if (mode === 'd1') {
      await loadD1(term);
      return;
    }
    if (mode === 'planes') {
      await loadPlanes(term, 1);
      return;
    }
    if (mode === 'hyperdrive') {
      await loadHyperdrive(term);
      return;
    }
    if (mode === 'vectorize') {
      await loadVectorize(term);
      return;
    }
    if (mode === 'command') {
      await loadCommands(term);
      return;
    }
    if (mode === 'workflow') {
      await loadWorkflows(term);
      return;
    }
    if (mode === 'file') {
      await loadFiles(term);
      return;
    }
    if (mode === 'search') {
      await loadContentSearch(term);
      return;
    }
    if (mode === 'clone') {
      await loadClone(term || q.trim());
      return;
    }
    if (sourceChip === 'files') {
      await loadFiles(term);
      return;
    }
    if (sourceChip === 'commands') {
      await loadCommands(term);
      return;
    }
    await loadUnifiedSearch(term, sourceChip);
  }, [mode, term, q, sourceChip, loadDefault, loadR2, loadD1, loadPlanes, loadHyperdrive, loadVectorize, loadCommands, loadWorkflows, loadFiles, loadContentSearch, loadClone, loadUnifiedSearch]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = mode === 'default' ? 0 : mode === 'clone' ? 0 : 180;
    debounceRef.current = setTimeout(() => void runQuery(), delay);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, q, mode, sourceChip, runQuery, workspaceId]);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQ('');
    setItems([]);
    setRecentSearches([]);
    setCommandSections([]);
    setPlaneSections([]);
    setPlanesCatalog(null);
    setSourceChip('all');
    setR2Catalog([]);
    setR2Page(1);
    setCfConnected(null);
  }, []);

  useEffect(() => {
    if (!shellDropdownHost) return;
    const onGitMenu = () => {
      setConnectionMenuOpen(false);
      setGitMenuOpen(true);
      closePalette();
    };
    const onConnectionMenu = () => {
      setGitMenuOpen(false);
      setConnectionMenuOpen(true);
      closePalette();
    };
    window.addEventListener(IAM_OPEN_GIT_REPO_MENU, onGitMenu);
    window.addEventListener(IAM_OPEN_CONNECTION_MENU, onConnectionMenu);
    return () => {
      window.removeEventListener(IAM_OPEN_GIT_REPO_MENU, onGitMenu);
      window.removeEventListener(IAM_OPEN_CONNECTION_MENU, onConnectionMenu);
    };
  }, [shellDropdownHost, closePalette]);

  useEffect(() => {
    if (!shellDropdownHost || (!gitMenuOpen && !connectionMenuOpen)) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (paletteRef.current?.contains(t)) return;
      if (connectionMenuRef.current?.contains(t)) return;
      if (gitMenuRef.current?.contains(t)) return;
      setGitMenuOpen(false);
      setConnectionMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [shellDropdownHost, gitMenuOpen, connectionMenuOpen]);

  const openR2Bucket = useCallback((bucket: string) => {
    try {
      sessionStorage.setItem('iam-palette-r2-bucket', bucket);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('iam-sidebar-toggle', { detail: { activity: 'remote', r2Bucket: bucket } }));
  }, []);

  const loadBucketMenu = useCallback(async () => {
    setBucketMenuLoading(true);
    try {
      if (collabR2Bucket && !isPlatformWorkspace(activeWorkspace)) {
        setBucketMenuRows([{ name: collabR2Bucket, bound: true }]);
        return;
      }
      const payload = await workspaceFetchJson<{ buckets?: string[]; bound?: string[] }>(
        '/api/r2/buckets',
      );
      const names = (payload?.buckets || payload?.bound || []).map(String);
      setBucketMenuRows(names.map((name) => ({ name, bound: true })));
    } catch (e) {
      console.error('Failed to load R2 bucket menu:', e);
    } finally {
      setBucketMenuLoading(false);
    }
  }, [activeWorkspace, collabR2Bucket, workspaceFetchJson]);

  useEffect(() => {
    if (!bucketMenuOpen) return;
    void loadBucketMenu();
  }, [bucketMenuOpen, loadBucketMenu, workspaceId]);

  useEffect(() => {
    if (!bucketMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (bucketMenuRef.current?.contains(e.target as Node)) return;
      setBucketMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [bucketMenuOpen]);

  const openDatabase = useCallback(
    (target?: 'd1' | 'hyperdrive') => {
      if (target === 'd1' && collabDbName) {
        navigate(databaseStudioPathFromName(collabDbName));
        return;
      }
      try {
        if (target) sessionStorage.setItem('iam-palette-db-target', target);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent('iam-sidebar-toggle', { detail: { activity: 'database', dbTarget: target } }));
    },
    [collabDbName, navigate],
  );

  const applyItem = useCallback(
    (item: PaletteItem, searchQuery: string) => {
      if (item.category === 'tip' || item.category === 'search') {
        if (item.title === '?') {
          setItems([
            { id: 'tip-planes', category: 'tip', title: 'planes:', subtitle: 'D1, R2, Hyperdrive & Vectorize' },
            { id: 'tip-r2', category: 'tip', title: 'r2:', subtitle: 'Search R2 buckets' },
            { id: 'tip-d1', category: 'tip', title: 'd1:', subtitle: 'List D1 databases' },
            { id: 'tip-hd', category: 'tip', title: 'hyperdrive:', subtitle: 'List Hyperdrive configs' },
            { id: 'tip-vx', category: 'tip', title: 'vectorize:', subtitle: 'List Vectorize indexes' },
            { id: 'tip-wf', category: 'tip', title: 'wf:', subtitle: 'Workflows' },
            { id: 'tip-clone', category: 'tip', title: 'clone ', subtitle: 'Clone a GitHub repo on your terminal' },
            { id: 'tip-clone-colon', category: 'tip', title: 'clone:', subtitle: 'Clone owner/repo or GitHub URL' },
            ...QUICK_OPEN_ACTIONS.filter((a) => a.title !== '?'),
          ]);
          setQ('');
                return;
        }
        setQ(item.title);
        return;
      }

      if (item.category === 'connect') {
        navigate('/dashboard/settings/integrations');
        closePalette();
        return;
      }

      void fetch('/api/unified-search/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          query: searchQuery,
          result_kind: item.category,
          search_type: item.category,
          opened_id: item.id,
          clicked_result_id: item.id,
          source: 'dashboard',
        }),
      }).catch(() => {});

      if (item.category === 'r2' || (item.category === 'resource' && item.r2Bucket)) {
        openR2Bucket(item.r2Bucket || item.title);
        closePalette();
        return;
      }

      if (item.category === 'd1') {
        const dbName = item.d1DatabaseName || item.title;
        if (dbName) {
          navigate(databaseStudioPathFromName(dbName));
          closePalette();
          return;
        }
        openDatabase(item.dbTarget);
        closePalette();
        return;
      }

      if (item.category === 'hyperdrive') {
        openDatabase('hyperdrive');
        closePalette();
        return;
      }

      if (item.category === 'vectorize') {
        if (item.vectorizeIndexName) {
          try {
            sessionStorage.setItem('iam-palette-vectorize-index', item.vectorizeIndexName);
          } catch {
            /* ignore */
          }
        }
        navigate('/dashboard/storage');
        closePalette();
        return;
      }

      if (item.category === 'chat' && item.conversationId) {
        resumeAgentChatSession({ id: item.conversationId, force: true });
        onNavigate({ kind: 'conversation', id: item.conversationId }, searchQuery);
        closePalette();
        return;
      }

      if (item.category === 'deploy') {
        if (item.deployAction === 'workers_builds') {
          window.dispatchEvent(new CustomEvent(IAM_GIT_SYNC_PUBLISH));
          closePalette();
          return;
        }
        navigate('/dashboard/analytics/deploys');
        closePalette();
        return;
      }

      if (item.category === 'github_clone' && item.cloneRef) {
        void runGithubClone(item.cloneRef);
        return;
      }

      if (item.category === 'command' && item.commandText) {
        void navigator.clipboard?.writeText(item.commandText).catch(() => {});
        setToast('Copied to clipboard');
        closePalette();
        return;
      }

      if (item.category === 'workflow' && item.workflowKey) {
        navigate('/dashboard/workflows');
        closePalette();
        return;
      }

      if (item.category === 'file' && item.filePath) {
        onNavigate(
          {
            kind: 'file',
            path: item.filePath,
            ...(item.fileLine != null ? { line: item.fileLine } : {}),
            ...(item.fileColumn != null ? { column: item.fileColumn } : {}),
          },
          searchQuery,
        );
        closePalette();
        return;
      }

      if (item.legacyRow) {
        const row = item.legacyRow;
        if (row.type === 'conversation' && row.id) {
          onNavigate({ kind: 'conversation', id: row.id }, searchQuery);
        } else if (row.type === 'table') {
          onNavigate({ kind: 'table', name: row.id }, searchQuery);
        } else if ((row.type === 'snippet' || row.type === 'query' || row.type === 'column') && row.sql_text) {
          onNavigate({ kind: row.type === 'column' ? 'column' : 'sql', sql: row.sql_text }, searchQuery);
        } else if (row.type === 'deployment') {
          navigate('/dashboard/analytics/deploys');
        } else {
          onNavigate({ kind: 'knowledge', url: row.url ?? null, label: row.title }, searchQuery);
        }
        closePalette();
        return;
      }

      closePalette();
    },
    [closePalette, navigate, onNavigate, openDatabase, openR2Bucket, runGithubClone],
  );

  const displaySections = useMemo(() => {
    if ((mode === 'command' || (mode === 'default' && sourceChip === 'commands')) && commandSections.length > 0) {
      return commandSections;
    }
    if (mode === 'planes' && planeSections.length > 0) {
      return planeSections;
    }

    const filtered = items.filter((item) => {
      if (item.category === 'tip' || item.category === 'connect') {
        return mode === 'default' && (!q.trim() || q.trim() === '?');
      }
      if (mode === 'file') return item.category === 'file';
      if (mode !== 'default' && mode !== 'search') return true;
      if (mode === 'search') return chipMatchesCategory(sourceChip, item.category);
      return chipMatchesCategory(sourceChip, item.category);
    });

    // ⌘K empty = Cursor Quick Open: actions + recent/connected files
    if (mode === 'default' && (!q.trim() || q.trim() === '?') && sourceChip === 'all') {
      const actions = filtered.filter((i) => i.category === 'tip' || i.category === 'connect');
      const files = filtered.filter((i) => i.category === 'file');
      if (q.trim() === '?') {
        return [{ key: 'more', label: 'More', rows: actions.length ? actions : QUICK_OPEN_ACTIONS }];
      }
      return [
        { key: 'actions', label: 'Actions', rows: actions.length ? actions : QUICK_OPEN_ACTIONS },
        ...(files.length ? [{ key: 'files', label: 'Recent files', rows: files }] : []),
      ].filter((s) => s.rows.length > 0);
    }

    if (mode === 'default' && !q.trim()) {
      const tips = paletteSearchTips(cfConnected);
      return [{ key: 'tips', label: 'Search tips', rows: tips }];
    }

    const title =
      mode === 'file'
        ? q.trim()
          ? 'Files'
          : 'Go to File'
        : sectionTitle(mode, sourceChip, !!q.trim());
    return [{ key: 'main', label: title || 'Results', rows: filtered.filter((i) => i.category !== 'tip') }];
  }, [items, mode, q, sourceChip, commandSections, planeSections, cfConnected]);

  const kumoPaletteGroups = useMemo<KumoCommandPaletteGroup[]>(() =>
    displaySections.map((section) => ({
      id: section.key,
      label: section.label || 'Results',
      items: section.rows.map((item, index) => {
        const Icon = rowIcon(item.category);
        const detailParts = [
          item.commandCategory ? WRANGLER_CATEGORY_LABELS[item.commandCategory] : null,
          item.subtitle || null,
          typeof item.objectCount === 'number' ? `${item.objectCount.toLocaleString()} objects` : null,
          item.bound ? 'Bound' : null,
        ].filter((part): part is string => Boolean(part));
        return {
          id: `${section.key}:${index}:${item.id}`,
          title: item.title,
          description: detailParts.join(' · ') || undefined,
          icon: item.category === 'file'
            ? <SetiFileIcon filename={item.filePath || item.title} size={14} />
            : <Icon
                size={14}
                className={item.category === 'r2' || item.category === 'resource' ? 'text-amber-500/90' : 'text-kumo-subtle'}
                aria-hidden
              />,
          data: item,
        };
      }),
    })),
  [displaySections]);

  const r2TotalPages = useMemo(
    () => Math.max(1, Math.ceil(r2Catalog.length / PALETTE_R2_PAGE_SIZE)),
    [r2Catalog.length],
  );

  useEffect(() => {
    if (mode === 'r2' && r2Catalog.length) {
      const start = (r2Page - 1) * PALETTE_R2_PAGE_SIZE;
      setItems(r2CatalogToPaletteItems(r2Catalog.slice(start, start + PALETTE_R2_PAGE_SIZE)));
      return;
    }
    if (mode === 'planes' && planesCatalog?.ok && r2Catalog.length) {
      const built = buildPlaneSectionsFromCatalog(planesCatalog, term, r2Page);
      setPlaneSections(built.sections);
      setItems(built.sections.flatMap((s) => s.rows));
    }
  }, [r2Page, r2Catalog, mode, planesCatalog, term]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        closePalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closePalette]);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const mobileCompact = mobileToolbar;
  return (
    <div
      ref={paletteRef}
      className={`nav-search-container min-w-0 ${mobileCompact ? `iam-nav-search--mobile${mobileToolbar ? ' iam-nav-search--toolbar' : ''}` : ''}`}
      data-mobile-compact={mobileCompact ? 'true' : undefined}
      data-palette-open={open ? 'true' : undefined}
    >
      {mobileCompact ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={
            mobileToolbar
              ? `p-1.5 rounded transition-colors ${
                  open
                    ? 'text-[var(--solar-cyan)] bg-[var(--bg-hover)]'
                    : 'text-muted hover:text-white hover:bg-[var(--bg-hover)]'
                }`
              : `flex items-center justify-center w-9 h-9 rounded-md border transition-colors ${
                  open
                    ? 'border-[var(--solar-cyan)]/50 bg-[var(--bg-hover)] text-[var(--solar-cyan)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-app)] text-muted hover:border-[var(--solar-cyan)]/40 hover:bg-[var(--bg-hover)] hover:text-main'
                }`
          }
          title="Go to File (Cmd+K)"
          aria-label="Go to File"
          aria-expanded={open}
        >
          <Search size={mobileToolbar ? 15 : 18} strokeWidth={1.75} aria-hidden />
        </button>
      ) : (
      <div className="nav-search-trigger flex items-stretch w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] hover:border-[var(--solar-cyan)]/40 transition-colors overflow-visible">
        {!hideWorkspaceSegment ? (
        <div className="flex items-stretch shrink-0 border-r border-[var(--border-subtle)]">
          <div className="relative shrink-0 max-w-[45%] border-r border-[var(--border-subtle)]" ref={gitMenuRef}>
            <GitRepoBranchNavTrigger
              workspaceLabel={workspaceLabel}
              gitBranch={gitBranch}
              open={gitMenuOpen}
              onToggle={() => {
                setConnectionMenuOpen(false);
                setGitMenuOpen((v) => !v);
                closePalette();
              }}
            />
            {gitMenuOpen ? (
              <GitRepoBranchMenuPanel
                open={gitMenuOpen}
                onClose={() => setGitMenuOpen(false)}
                variant="dropdown"
                activeWorkspaceId={activeWorkspaceId}
                currentBranch={gitBranch}
                workspaceRepoHint={workspaceRepoHint}
                onBranchSelect={onGitBranchSelect}
                onOpenCommandPalette={onOpenCommandPalette}
                onGitBranchClick={() => {
                  setGitMenuOpen(false);
                  onGitBranchPanelClick?.();
                }}
                onWorkspacePickerClick={() => {
                  setGitMenuOpen(false);
                  onWorkspacePickerClick?.();
                }}
              />
            ) : null}
          </div>
          <div className="relative shrink-0" ref={connectionMenuRef}>
            <button
              type="button"
              onClick={() => {
                setGitMenuOpen(false);
                setConnectionMenuOpen((v) => !v);
                closePalette();
              }}
              className="flex items-center justify-center h-full px-2.5 hover:bg-[var(--bg-hover)] transition-colors text-muted hover:text-main"
              title="Connection options"
              aria-label="Connection options"
              aria-expanded={connectionMenuOpen}
            >
              <Router size={12} className="text-[var(--solar-cyan)]" strokeWidth={1.25} />
            </button>
            {connectionMenuOpen ? (
              <ConnectionMenuPanel
                open={connectionMenuOpen}
                onClose={() => setConnectionMenuOpen(false)}
                onAction={(action) => onConnectionMenuAction?.(action)}
                variant="anchored"
              />
            ) : null}
          </div>
          <button
            type="button"
            onClick={openFilesSearch}
            className="flex items-center justify-center h-full px-2.5 hover:bg-[var(--bg-hover)] transition-colors text-muted hover:text-main border-l border-[var(--border-subtle)]"
            title="Go to File (Cmd+K)"
            aria-label="Go to File"
          >
            <FolderSearch size={13} strokeWidth={1.5} className="text-[var(--solar-cyan)]" />
          </button>
        </div>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 min-w-0 px-2 py-1.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
          title="Go to File (Cmd+K)"
        >
          <Search size={14} className="shrink-0 opacity-70 text-muted" />
          <span className="text-[11px] text-muted truncate flex-1">Go to File…</span>
          <kbd className="hidden xl:inline text-[9px] font-mono px-1 py-px rounded border border-[var(--border-subtle)] text-muted shrink-0">
            {isMac ? 'Cmd' : 'Ctrl'}+K
          </kbd>
        </button>
      </div>
      )}

      <CommandPaletteShell
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpen(true);
          else closePalette();
        }}
        query={q}
        onQueryChange={setQ}
        groups={kumoPaletteGroups}
        loading={loading}
        placeholder="Search files, content, symbols, data, or commands…"
        leading={<Search size={16} className="text-kumo-subtle" aria-hidden />}
        toolbar={
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_CHIPS.map(({ id, label, Icon }) => {
              const selected = activeChip === id || (id === 'files' && mode === 'file');
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (id === 'all') {
                      setSourceChip('all');
                      setQ('');
                      return;
                    }
                    if (id === 'files') {
                      setSourceChip('files');
                      setQ('');
                      void loadFiles('');
                      return;
                    }
                    if (id === 'planes') {
                      activateDataPlaneChip('planes', 'planes:');
                      return;
                    }
                    if (id === 'r2') {
                      activateDataPlaneChip('r2', 'r2:');
                      return;
                    }
                    if (id === 'd1') {
                      activateDataPlaneChip('d1', 'd1:');
                      return;
                    }
                    if (id === 'commands') {
                      activateDataPlaneChip('commands', '/');
                      return;
                    }
                    setSourceChip(id);
                  }}
                  className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                    selected
                      ? 'border-kumo-brand/40 bg-kumo-tint text-kumo-default'
                      : 'border-kumo-line bg-kumo-base text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default'
                  }`}
                >
                  <Icon size={12} aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
        }
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-[11px] text-kumo-subtle">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>⌘↵ new tab</span>
            </div>
            {(mode === 'r2' || mode === 'planes') && r2TotalPages > 1 ? (
              <div className="flex items-center gap-2 text-[11px] text-kumo-subtle">
                <button
                  type="button"
                  disabled={r2Page <= 1}
                  onClick={() => setR2Page((page) => Math.max(1, page - 1))}
                  className="rounded-md border border-kumo-line px-2 py-1 disabled:opacity-40"
                >
                  Previous
                </button>
                <span>{r2Page}/{r2TotalPages}</span>
                <button
                  type="button"
                  disabled={r2Page >= r2TotalPages}
                  onClick={() => setR2Page((page) => Math.min(r2TotalPages, page + 1))}
                  className="rounded-md border border-kumo-line px-2 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        }
        onSelect={(entry) => {
          const item = entry.data as PaletteItem | undefined;
          if (item) applyItem(item, q.trim());
        }}
      />

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[12px] text-main shadow-xl">
          {toast}
        </div>
      ) : null}

      {shellDropdownHost &&
        hideWorkspaceSegment &&
        (gitMenuOpen || connectionMenuOpen) &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed z-[199] left-1/2 -translate-x-1/2 rounded-b-[var(--shell-dropdown-radius,6px)] overflow-hidden shadow-2xl"
            style={{
              top: 'var(--dashboard-topbar-height, 2.5rem)',
              width: SHELL_DROPDOWN_WIDTH_PX,
              maxWidth: 'min(600px, calc(100vw - 1.5rem))',
            }}
          >
            {gitMenuOpen ? (
              <GitRepoBranchMenuPanel
                open={gitMenuOpen}
                onClose={() => setGitMenuOpen(false)}
                variant="floating"
                className="rounded-t-none rounded-b-[var(--shell-dropdown-radius,6px)] w-full"
                activeWorkspaceId={activeWorkspaceId}
                currentBranch={gitBranch}
                workspaceRepoHint={workspaceRepoHint}
                onBranchSelect={onGitBranchSelect}
                onOpenCommandPalette={onOpenCommandPalette}
                onGitBranchClick={() => {
                  setGitMenuOpen(false);
                  onGitBranchPanelClick?.();
                }}
                onWorkspacePickerClick={() => {
                  setGitMenuOpen(false);
                  onWorkspacePickerClick?.();
                }}
              />
            ) : null}
            {connectionMenuOpen ? (
              <ConnectionMenuPanel
                open={connectionMenuOpen}
                onClose={() => setConnectionMenuOpen(false)}
                onAction={(action) => onConnectionMenuAction?.(action)}
                variant="floating"
                className="rounded-t-none rounded-b-[var(--shell-dropdown-radius,6px)] w-full"
              />
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
};
