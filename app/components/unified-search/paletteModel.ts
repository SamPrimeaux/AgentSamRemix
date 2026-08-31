import type React from 'react';
import {
  Database,
  FileText,
  HardDrive,
  Layers,
  LayoutGrid,
  MessageSquare,
  Router,
  Search,
  Terminal,
  Workflow,
} from 'lucide-react';
import {
  filterWranglerCatalog,
  normalizeCommandRow,
  type WranglerCatalogEntry,
  type WranglerCommandCategory,
} from '../../lib/wranglerCommandCatalog';
import { filterDeployPaletteRows } from '../../src/lib/deployPaletteItems';
import { isGithubCloneQuery } from '../../src/lib/githubClone';
import {
  PALETTE_R2_PAGE_SIZE,
  filterPaletteR2Buckets,
} from '../../src/lib/paletteCloudflare';

export type UnifiedSearchNavigate =
  | { kind: 'table'; name: string }
  | { kind: 'conversation'; id: string }
  | { kind: 'knowledge'; url: string | null; label: string }
  | { kind: 'sql'; sql: string }
  | { kind: 'deployment'; summary: string }
  | { kind: 'column'; sql: string }
  | { kind: 'file'; path: string; line?: number; column?: number };

export type SourceChipId = 'all' | 'planes' | 'r2' | 'd1' | 'commands' | 'workflows' | 'chats' | 'files';

export type PaletteCategory =
  | 'resource'
  | 'r2'
  | 'd1'
  | 'hyperdrive'
  | 'vectorize'
  | 'chat'
  | 'deploy'
  | 'command'
  | 'workflow'
  | 'file'
  | 'tip'
  | 'search'
  | 'github_clone'
  | 'connect';

export type PaletteItem = {
  id: string;
  category: PaletteCategory;
  title: string;
  subtitle?: string;
  bound?: boolean;
  objectCount?: number | null;
  commandText?: string;
  conversationId?: string;
  workflowKey?: string;
  r2Bucket?: string;
  dbTarget?: 'd1' | 'hyperdrive';
  filePath?: string;
  /** 1-based line for content search hits */
  fileLine?: number;
  fileColumn?: number;
  deploySummary?: string;
  deployAction?: 'workers_builds' | 'open_deploys';
  commandCategory?: WranglerCommandCategory;
  /** Unified-search row passthrough */
  legacyRow?: LegacyUnifiedRow;
  cloneRef?: string;
  d1DatabaseName?: string;
  hyperdriveId?: string;
  vectorizeIndexName?: string;
};

export type CommandSection = { key: string; label: string; rows: PaletteItem[] };

export type LegacyUnifiedRow = {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  sql_text?: string;
  url?: string | null;
  summary?: string;
};

export type GithubRepoListRow = { full_name?: string; name?: string; html_url?: string; private?: boolean };

export type QueryMode = 'default' | 'planes' | 'r2' | 'd1' | 'hyperdrive' | 'vectorize' | 'command' | 'workflow' | 'file' | 'search' | 'clone';

export const SOURCE_CHIPS: { id: SourceChipId; label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'all', label: 'All', Icon: LayoutGrid },
  { id: 'files', label: 'Files', Icon: FileText },
  { id: 'planes', label: 'Planes', Icon: Layers },
  { id: 'r2', label: 'R2', Icon: HardDrive },
  { id: 'd1', label: 'D1', Icon: Database },
  { id: 'commands', label: 'Commands', Icon: Terminal },
  { id: 'workflows', label: 'Workflows', Icon: Workflow },
  { id: 'chats', label: 'Chats', Icon: MessageSquare },
];

const SEARCH_TIPS: PaletteItem[] = [
  { id: 'tip-cmd', category: 'tip', title: '/', subtitle: 'Show and run commands' },
  { id: 'tip-hash', category: 'tip', title: '#', subtitle: 'Search files, content, and knowledge' },
  { id: 'tip-at', category: 'tip', title: '@', subtitle: 'Go to file in connected folder' },
  { id: 'tip-more', category: 'tip', title: '?', subtitle: 'Platform: r2: · d1: · planes: · wf:' },
];

/** Empty ⌘K Quick Open — Cursor-style action rows (tips set the query prefix). */
export const QUICK_OPEN_ACTIONS: PaletteItem[] = [
  { id: 'qo-cmd', category: 'tip', title: '/', subtitle: 'Show and run commands' },
  { id: 'qo-hash', category: 'tip', title: '#', subtitle: 'Search for text' },
  { id: 'qo-at', category: 'tip', title: '@', subtitle: 'Go to file' },
  { id: 'qo-more', category: 'tip', title: '?', subtitle: 'More — r2:, d1:, planes:, wf:' },
];

export function paletteSearchTips(_cfConnected: boolean | null): PaletteItem[] {
  return SEARCH_TIPS;
}

export function r2CatalogToPaletteItems(rows: { name: string; bound: boolean }[]): PaletteItem[] {
  return rows.map((b) => ({
    id: `r2-${b.name}`,
    category: 'r2' as const,
    title: b.name,
    subtitle: b.bound ? 'Bound to this Worker' : 'Account bucket',
    bound: b.bound,
    r2Bucket: b.name,
  }));
}

export function d1RowsToPalette(
  rows: { name: string; uuid?: string; bound?: boolean }[],
): PaletteItem[] {
  return rows.map((db) => ({
    id: `d1-db-${db.name}`,
    category: 'd1' as const,
    title: db.name,
    subtitle: db.bound ? 'D1 database · bound to Worker' : 'D1 database · your Cloudflare account',
    bound: db.bound,
    d1DatabaseName: db.name,
    dbTarget: 'd1' as const,
  }));
}

export function hyperdriveRowsToPalette(
  rows: { id: string; name: string; bound?: boolean }[],
): PaletteItem[] {
  return rows.map((cfg) => ({
    id: `hd-${cfg.id}`,
    category: 'hyperdrive' as const,
    title: cfg.name,
    subtitle: cfg.bound ? 'Hyperdrive · bound to Worker' : 'Hyperdrive config · your account',
    bound: cfg.bound,
    hyperdriveId: cfg.id,
    dbTarget: 'hyperdrive' as const,
  }));
}

export function vectorizeRowsToPalette(
  rows: { name: string; description?: string | null; bound?: boolean }[],
): PaletteItem[] {
  return rows.map((idx) => ({
    id: `vx-${idx.name}`,
    category: 'vectorize' as const,
    title: idx.name,
    subtitle: idx.bound
      ? 'Vectorize index · bound to Worker'
      : idx.description || 'Vectorize index · your account',
    bound: idx.bound,
    vectorizeIndexName: idx.name,
  }));
}

export function buildPlaneSectionsFromCatalog(
  catalog: {
    d1?: { name: string; id?: string; bound?: boolean }[];
    r2?: { name: string; bound?: boolean }[];
    hyperdrive?: { id: string; name: string; bound?: boolean }[];
    vectorize?: { name: string; description?: string | null; bound?: boolean }[];
  },
  searchTerm: string,
  r2PageNum: number,
): { sections: CommandSection[]; r2Catalog: { name: string; bound: boolean }[] } {
  const term = searchTerm.trim().toLowerCase();
  const match = (name: string) => !term || name.toLowerCase().includes(term);

  const sections: CommandSection[] = [];

  const d1Rows = d1RowsToPalette((catalog.d1 || []).filter((db) => match(db.name)));
  if (d1Rows.length) sections.push({ key: 'd1', label: 'D1 Databases', rows: d1Rows });

  const r2Sorted = filterPaletteR2Buckets(
    (catalog.r2 || []).map((b) => ({ name: b.name, bound: !!b.bound })),
    searchTerm,
  );
  const r2Start = (r2PageNum - 1) * PALETTE_R2_PAGE_SIZE;
  const r2PageRows = r2CatalogToPaletteItems(r2Sorted.slice(r2Start, r2Start + PALETTE_R2_PAGE_SIZE));
  if (r2PageRows.length) sections.push({ key: 'r2', label: 'R2 Buckets', rows: r2PageRows });

  const hdRows = hyperdriveRowsToPalette(
    (catalog.hyperdrive || []).filter((c) => match(c.name || c.id)),
  );
  if (hdRows.length) sections.push({ key: 'hyperdrive', label: 'Hyperdrive', rows: hdRows });

  const vxRows = vectorizeRowsToPalette((catalog.vectorize || []).filter((i) => match(i.name)));
  if (vxRows.length) sections.push({ key: 'vectorize', label: 'Vectorize', rows: vxRows });

  return { sections, r2Catalog: r2Sorted };
}

export function deployRowToPalette(row: ReturnType<typeof filterDeployPaletteRows>[number]): PaletteItem {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    subtitle: row.subtitle,
    commandText: row.commandText,
    deployAction: row.deployAction,
  };
}

export function catalogEntryToPalette(c: WranglerCatalogEntry): PaletteItem {
  return {
    id: c.id,
    category: 'command',
    title: c.display_name,
    subtitle: c.mapped_command,
    commandText: c.mapped_command,
    commandCategory: c.category,
  };
}

export function mergeCommandCatalog(
  apiRows: Record<string, unknown>[],
  searchTerm: string,
  limit = 80,
): WranglerCatalogEntry[] {
  const byCmd = new Map<string, WranglerCatalogEntry>();
  for (const raw of apiRows) {
    const n = normalizeCommandRow(raw);
    if (n) byCmd.set(n.mapped_command.toLowerCase(), n);
  }
  for (const c of filterWranglerCatalog(searchTerm, limit)) {
    if (!byCmd.has(c.mapped_command.toLowerCase())) byCmd.set(c.mapped_command.toLowerCase(), c);
  }
  return [...byCmd.values()].sort((a, b) => (a.sort_order ?? 50) - (b.sort_order ?? 0));
}

export function parseQueryMode(raw: string): { mode: QueryMode; term: string } {
  const q = raw.trim();
  const lower = q.toLowerCase();
  if (lower.startsWith('r2:')) return { mode: 'r2', term: q.slice(3).trim() };
  if (lower === 'r2' || lower.startsWith('r2 ')) return { mode: 'r2', term: q.replace(/^r2\s*/i, '').trim() };
  if (lower.startsWith('d1:')) return { mode: 'd1', term: q.slice(3).trim() };
  if (lower === 'd1' || lower.startsWith('d1 ')) return { mode: 'd1', term: q.replace(/^d1\s*/i, '').trim() };
  if (lower.startsWith('planes:')) return { mode: 'planes', term: q.slice(7).trim() };
  if (lower === 'planes' || lower.startsWith('planes ')) {
    return { mode: 'planes', term: q.replace(/^planes\s*/i, '').trim() };
  }
  if (lower.startsWith('hyperdrive:') || lower.startsWith('hd:')) {
    return { mode: 'hyperdrive', term: q.replace(/^(hyperdrive|hd):/i, '').trim() };
  }
  if (lower === 'hyperdrive' || lower === 'hd' || lower.startsWith('hyperdrive ') || lower.startsWith('hd ')) {
    return { mode: 'hyperdrive', term: q.replace(/^(hyperdrive|hd)\s*/i, '').trim() };
  }
  if (lower.startsWith('vectorize:') || lower.startsWith('vx:')) {
    return { mode: 'vectorize', term: q.replace(/^(vectorize|vx):/i, '').trim() };
  }
  if (lower === 'vectorize' || lower === 'vx' || lower.startsWith('vectorize ') || lower.startsWith('vx ')) {
    return { mode: 'vectorize', term: q.replace(/^(vectorize|vx)\s*/i, '').trim() };
  }
  // Cursor Quick Open prefixes
  if (q.startsWith('>') || q.startsWith('/')) {
    return { mode: 'command', term: q.replace(/^[>/]/, '').trim() };
  }
  if (q.startsWith('#')) return { mode: 'search', term: q.slice(1).trim() };
  if (q.startsWith('?')) {
    // Help → stay on default empty actions, or show tip list via empty load
    return { mode: 'default', term: '' };
  }
  if (lower.startsWith('wf:') || lower === 'wf' || lower.startsWith('wf ')) {
    return { mode: 'workflow', term: q.replace(/^wf:?/i, '').trim() };
  }
  if (q.startsWith('@')) return { mode: 'file', term: q.slice(1).trim() };
  if (lower.startsWith('clone:')) return { mode: 'clone', term: q.slice(6).trim() };
  if (lower.startsWith('clone ') || lower === 'clone' || isGithubCloneQuery(q)) {
    return { mode: 'clone', term: q.replace(/^clone\s*/i, '').trim() || q.trim() };
  }
  // File-first: any bare query is Go to File (not unified platform search)
  if (q.length >= 1) return { mode: 'file', term: q };
  return { mode: 'default', term: q };
}

export function chipMatchesCategory(chip: SourceChipId, category: PaletteCategory): boolean {
  if (chip === 'all') return category !== 'tip' && category !== 'connect';
  if (chip === 'files') return category === 'file';
  if (chip === 'r2') return category === 'r2' || category === 'resource';
  if (chip === 'd1') return category === 'd1';
  if (chip === 'planes') {
    return category === 'd1' || category === 'r2' || category === 'hyperdrive' || category === 'vectorize';
  }
  if (chip === 'commands') return category === 'command' || category === 'deploy';
  if (chip === 'workflows') return category === 'workflow';
  if (chip === 'chats') return category === 'chat';
  return true;
}


export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function normalizeLegacySearchRows(data: Record<string, unknown>): LegacyUnifiedRow[] {
  const ranked = data.results;
  if (!Array.isArray(ranked)) return [];
  const out: LegacyUnifiedRow[] = [];
  for (const raw of ranked) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const type = String(r.type || '');
    out.push({
      type,
      id: String(r.id ?? r.path ?? ''),
      title: String(r.title ?? ''),
      subtitle: r.subtitle != null ? String(r.subtitle) : undefined,
      sql_text: r.sql_text != null ? String(r.sql_text) : undefined,
      url: r.url != null ? String(r.url) : null,
      summary: r.summary != null ? String(r.summary) : undefined,
    });
  }
  return out;
}

export function legacyToPalette(row: LegacyUnifiedRow): PaletteItem | null {
  const id = `${row.type}-${row.id}`;
  switch (row.type) {
    case 'deployment':
      return {
        id,
        category: 'deploy',
        title: row.title,
        subtitle: row.subtitle,
        deploySummary: row.summary || row.subtitle || row.title,
        legacyRow: row,
      };
    case 'conversation':
      return {
        id,
        category: 'chat',
        title: row.title,
        subtitle: row.subtitle,
        conversationId: row.id,
        legacyRow: row,
      };
    case 'command':
      return {
        id,
        category: 'command',
        title: row.title,
        subtitle: row.subtitle,
        commandText: row.sql_text || row.title,
        legacyRow: row,
      };
    case 'workspace':
    case 'branch':
    case 'repo':
      return {
        id,
        category: 'search',
        title: row.title,
        subtitle: row.subtitle || row.type,
        legacyRow: row,
      };
    default:
      if (row.type === 'table' || row.type === 'snippet' || row.type === 'query' || row.type === 'column') {
        return {
          id,
          category: 'search',
          title: row.title,
          subtitle: row.subtitle || row.type,
          legacyRow: row,
        };
      }
      return {
        id,
        category: 'search',
        title: row.title,
        subtitle: row.subtitle,
        legacyRow: row,
      };
  }
}

export function sectionTitle(mode: QueryMode, chip: SourceChipId, hasQuery: boolean): string | null {
  if (!hasQuery && mode === 'default') return null;
  if (mode === 'r2') return 'R2 Buckets';
  if (mode === 'd1') return 'D1 Databases';
  if (mode === 'planes') return 'Data planes';
  if (mode === 'hyperdrive') return 'Hyperdrive';
  if (mode === 'vectorize') return 'Vectorize';
  if (mode === 'command') return 'Commands';
  if (mode === 'workflow') return 'Workflows';
  if (mode === 'file') return 'Files';
  if (mode === 'search') return 'Search results';
  if (chip !== 'all') return SOURCE_CHIPS.find((c) => c.id === chip)?.label ?? 'Results';
  return 'Results';
}

export function rowIcon(category: PaletteCategory) {
  switch (category) {
    case 'r2':
    case 'resource':
      return HardDrive;
    case 'd1':
      return Database;
    case 'hyperdrive':
      return Router;
    case 'vectorize':
      return Layers;
    case 'command':
      return Terminal;
    case 'workflow':
      return Workflow;
    case 'chat':
      return MessageSquare;
    case 'deploy':
      return Layers;
    case 'file':
      return FileText;
    case 'connect':
      return HardDrive;
    default:
      return Search;
  }
}
