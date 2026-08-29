import React from 'react';
import {
  ChevronRight,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Table as TableIcon,
  X,
} from 'lucide-react';

import { highlightSearchMatchAll } from '../../../src/lib/highlightSearchMatch';
import {
  databaseTableSelectionKey as tableSelectionKey,
  type DatabaseTableMeta as TableMeta,
} from '../../../src/lib/databaseStudioModels';
import type { DatabaseStudioDatasource } from '../../../src/lib/databaseStudioRoute';

type ColumnHint = { name: string; type?: string };

type Props = {
  width: number;
  collapsed: boolean;
  dragging: boolean;
  effectiveDatasource: DatabaseStudioDatasource;
  isSuperadmin: boolean;
  supabaseConnected: boolean;
  supabaseConnectUrl: string;
  tableSearch: string;
  onTableSearchChange: (value: string) => void;
  filteredTables: TableMeta[];
  selectedTable: string | null;
  expandedTables: Set<string>;
  columnCache: Record<string, ColumnHint[] | undefined>;
  columnLoading: Record<string, boolean>;
  pageReady: boolean;
  loadingTables: boolean;
  d1LoadError: string | null;
  d1OnboardingRequired: boolean;
  sidebarEmptyMuted: boolean;
  onSelectD1: () => void;
  onSelectSupabase: () => void;
  onRefreshTables: () => void;
  onClearSql: () => void;
  onExpandSidebar: () => void;
  onBeginResize: (e: React.PointerEvent<HTMLDivElement>) => void;
  onToggleCollapsed: () => void;
  onPickTable: (selectionKey: string) => void;
  onToggleColumns: (selectionKey: string, ev: React.MouseEvent) => void;
  onOpenTableMenu: (selectionKey: string, x: number, y: number) => void;
};

export function DatabaseTablesRail({
  width,
  collapsed,
  dragging,
  effectiveDatasource,
  isSuperadmin,
  supabaseConnected,
  supabaseConnectUrl,
  tableSearch,
  onTableSearchChange,
  filteredTables,
  selectedTable,
  expandedTables,
  columnCache,
  columnLoading,
  pageReady,
  loadingTables,
  d1LoadError,
  d1OnboardingRequired,
  sidebarEmptyMuted,
  onSelectD1,
  onSelectSupabase,
  onRefreshTables,
  onClearSql,
  onExpandSidebar,
  onBeginResize,
  onToggleCollapsed,
  onPickTable,
  onToggleColumns,
  onOpenTableMenu,
}: Props) {
  return (
    <>
      {/* Mobile-only: expanded rail becomes an overlay drawer (see database-page.css);
          tapping the backdrop closes it. No-op / hidden on desktop via CSS. */}
      {!collapsed ? (
        <div
          className="database-tables-rail-backdrop"
          aria-hidden="true"
          onClick={onToggleCollapsed}
        />
      ) : null}
      <aside
        className="database-tables-rail flex shrink-0 flex-col overflow-hidden border-r border-[var(--database-border)] bg-[var(--database-panel)] md:border-r-0"
        data-collapsed={collapsed ? 'true' : 'false'}
        style={{ width }}
        aria-label="Database tables"
      >
        {collapsed ? (
          <div className="flex h-full flex-col items-center gap-2 py-3">
            <button
              type="button"
              title="Expand table list"
              onClick={onExpandSidebar}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-muted hover:bg-[var(--bg-hover)] hover:text-main"
            >
              <PanelLeftOpen size={14} />
            </button>
            <button
              type="button"
              title="Refresh tables"
              onClick={onRefreshTables}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-muted hover:bg-[var(--bg-hover)] hover:text-main"
            >
              <RefreshCw size={14} className={loadingTables ? 'animate-spin' : ''} />
            </button>
          </div>
        ) : (
          <>
            <div className="border-b border-[var(--border-subtle)] p-3">
              <div className="flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-0.5">
                <button
                  type="button"
                  onClick={onSelectD1}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-black tracking-widest ${
                    effectiveDatasource === 'd1'
                      ? 'bg-[var(--color-accent,var(--solar-cyan))]/15 text-[var(--color-accent,var(--solar-cyan))]'
                      : 'text-muted hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  D1
                </button>
                <button
                  type="button"
                  onClick={onSelectSupabase}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-black tracking-widest ${
                    effectiveDatasource === 'supabase'
                      ? 'bg-[var(--color-accent,var(--solar-cyan))]/15 text-[var(--color-accent,var(--solar-cyan))]'
                      : 'text-muted hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  Supabase DB
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  title="Refresh tables"
                  onClick={onRefreshTables}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-muted hover:bg-[var(--bg-hover)] hover:text-main"
                >
                  <RefreshCw size={14} className={loadingTables ? 'animate-spin' : ''} />
                </button>
                <button
                  type="button"
                  title="Clear SQL editor"
                  onClick={onClearSql}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-muted hover:bg-[var(--bg-hover)] hover:text-main"
                >
                  <X size={14} />
                </button>
                {/* Desktop closes via the drag-splitter's double-click (CSS-hidden on
                    mobile), so mobile needs its own explicit collapse control. */}
                <button
                  type="button"
                  title="Collapse table list"
                  onClick={onToggleCollapsed}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-muted hover:bg-[var(--bg-hover)] hover:text-main md:hidden"
                >
                  <PanelLeftClose size={14} />
                </button>
              </div>
            </div>

            <div className="border-b border-[var(--border-subtle)] p-3">
              {effectiveDatasource === 'supabase' && !isSuperadmin && !supabaseConnected ? (
                <a
                  href={supabaseConnectUrl}
                  className="mb-2 flex w-full items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--solar-cyan)_40%,transparent)] bg-[color-mix(in_srgb,var(--solar-cyan)_12%,transparent)] px-2 py-2 text-[10px] font-bold text-[var(--solar-cyan)] no-underline"
                >
                  Connect Supabase
                </a>
              ) : null}
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5">
                <Search size={12} className="shrink-0 text-muted" />
                <input
                  value={tableSearch}
                  onChange={(e) => onTableSearchChange(e.target.value)}
                  placeholder="Search tables"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto py-1">
              {filteredTables.map((table) => {
                const selectionKey = tableSelectionKey(table, effectiveDatasource);
                const open = expandedTables.has(selectionKey);
                const cols = columnCache[selectionKey];
                const loadingCols = columnLoading[selectionKey];
                return (
                  <div
                    key={selectionKey}
                    className="border-b border-[var(--border-subtle)]/40"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onOpenTableMenu(selectionKey, e.clientX, e.clientY);
                    }}
                  >
                    <div className="flex items-stretch">
                      <button
                        type="button"
                        title={open ? 'Collapse columns' : 'Expand columns'}
                        onClick={(e) => onToggleColumns(selectionKey, e)}
                        className="flex w-7 shrink-0 items-center justify-center text-muted hover:bg-[var(--bg-hover)]"
                      >
                        <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onPickTable(selectionKey)}
                        className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-0 pr-1 text-left font-mono text-[11px] ${
                          selectedTable === selectionKey
                            ? 'bg-[var(--color-accent,var(--solar-cyan))]/10 text-[var(--color-accent,var(--solar-cyan))]'
                            : 'hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        <TableIcon size={12} className="shrink-0 opacity-70" />
                        <span className="min-w-0 truncate font-mono text-[11px]">
                          {table.table_schema && effectiveDatasource === 'supabase' ? (
                            <span className="text-muted">{table.table_schema}.</span>
                          ) : null}
                          {highlightSearchMatchAll(table.name, tableSearch)}
                        </span>
                      </button>
                      <button
                        type="button"
                        title="Table actions"
                        aria-label={`Actions for ${table.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          onOpenTableMenu(selectionKey, rect.right, rect.bottom);
                        }}
                        className="flex w-7 shrink-0 items-center justify-center text-muted hover:bg-[var(--bg-hover)] hover:text-main"
                      >
                        <MoreHorizontal size={13} />
                      </button>
                    </div>
                    {open && (
                      <div className="border-t border-[var(--border-subtle)]/30 bg-[var(--bg-app)]/50 py-1 pl-8 pr-2">
                        {loadingCols ? (
                          <div className="flex items-center gap-2 py-1 text-[10px] text-muted">
                            <Loader2 size={11} className="animate-spin" /> Loading columns…
                          </div>
                        ) : (cols || []).length ? (
                          <ul className="space-y-0.5 text-[10px] text-muted">
                            {cols!.map((c) => (
                              <li key={c.name} className="flex justify-between gap-2 font-mono">
                                <span className="min-w-0 truncate text-main">{c.name}</span>
                                <span className="shrink-0 opacity-80">{c.type || 'TEXT'}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="py-1 text-[10px] text-muted">No columns</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {!filteredTables.length && (
                <div className="p-4 text-center font-mono text-[11px] text-muted">
                  <p>
                    {!pageReady
                      ? 'Loading tables…'
                      : d1LoadError
                        ? d1LoadError
                        : loadingTables
                          ? 'Loading tables…'
                          : sidebarEmptyMuted
                            ? '—'
                            : 'No tables match'}
                  </p>
                  {d1OnboardingRequired ? (
                    <a
                      href={`/api/oauth/cloudflare/start?return_to=${encodeURIComponent('/dashboard/database?studio=1')}`}
                      className="mt-3 inline-flex items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--solar-cyan)_40%,transparent)] bg-[color-mix(in_srgb,var(--solar-cyan)_12%,transparent)] px-3 py-2 text-[11px] font-bold text-[var(--solar-cyan)] no-underline"
                    >
                      Connect Cloudflare (official OAuth)
                    </a>
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        title="Drag to resize table list · double-click to collapse"
        className="database-splitter-col hidden md:block"
        data-dragging={dragging ? 'true' : undefined}
        onPointerDown={onBeginResize}
        onDoubleClick={onToggleCollapsed}
      />
    </>
  );
}
