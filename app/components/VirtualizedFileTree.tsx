import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Loader2,
} from 'lucide-react';
import {
  LOCAL_TREE_ROW_HEIGHT_PX,
  type LocalFileTreeRow,
} from '../src/lib/localFileTree';
import { SetiFileIcon } from '../src/components/SetiFileIcon';
import type { FsChangeEntry, FsInspectionWidthBand } from '../src/lib/agentSamFsChanges';
import { glyphForChangeState } from '../src/lib/agentSamFsChanges';

const OVERSCAN = 10;

export type VirtualizedFileTreeProps = {
  rows: LocalFileTreeRow[];
  rowHeight?: number;
  className?: string;
  maxHeight?: string;
  /** When true, tree fills parent flex column (AgentSamFilesystem). */
  fillHeight?: boolean;
  ariaLabel?: string;
  onRowClick: (row: LocalFileTreeRow) => void;
  /** Optional Changes-mode annotations keyed by repo-relative or tree path. */
  changeByPath?: Map<string, FsChangeEntry> | null;
  /** Resolve tree row id → change entry (handles root folder prefix). */
  resolveChange?: (treePath: string) => FsChangeEntry | undefined;
  widthBand?: FsInspectionWidthBand;
  selectedPath?: string | null;
  /** Dim rows that have no change annotation (when showing mixed tree). */
  dimUnchanged?: boolean;
};

function changeColorClass(state: FsChangeEntry['state'] | undefined): string {
  if (state === 'added') return 'text-[var(--solar-green)]';
  if (state === 'deleted') return 'text-[var(--solar-red,#f85149)]';
  if (state === 'renamed') return 'text-[var(--solar-cyan)]';
  if (state === 'modified') return 'text-[#dab98f]';
  return 'text-muted';
}

export const VirtualizedFileTree: React.FC<VirtualizedFileTreeProps> = ({
  rows,
  rowHeight = LOCAL_TREE_ROW_HEIGHT_PX,
  className = '',
  maxHeight = 'min(45vh, 480px)',
  fillHeight = false,
  ariaLabel = 'Local files',
  onRowClick,
  changeByPath = null,
  resolveChange,
  widthBand = 'narrow',
  selectedPath = null,
  dimUnchanged = false,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const [viewportH, setViewportH] = useState(320);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewportH(el.clientHeight || 320);
    });
    ro.observe(el);
    setViewportH(el.clientHeight || 320);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    scrollTopRef.current = el.scrollTop;
    setScrollTop(el.scrollTop);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - scrollTopRef.current) > 1) {
      el.scrollTop = scrollTopRef.current;
    }
  }, [rows]);

  const lookup = useCallback(
    (treePath: string): FsChangeEntry | undefined => {
      if (resolveChange) return resolveChange(treePath);
      if (!changeByPath) return undefined;
      return changeByPath.get(treePath);
    },
    [changeByPath, resolveChange],
  );

  const totalH = rows.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / rowHeight) + OVERSCAN);
  const paddingTop = start * rowHeight;
  const paddingBottom = Math.max(0, totalH - paddingTop - (end - start) * rowHeight);
  const slice = rows.slice(start, end);

  if (!rows.length) {
    return (
      <p className="px-2 py-2 text-[10px] text-muted">Empty folder</p>
    );
  }

  const entryCount = rows.filter((r) => r.type === 'entry').length;

  return (
    <div className={`flex flex-col min-h-0 ${fillHeight ? 'flex-1 h-full' : ''}`}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={`overflow-auto overscroll-contain ${fillHeight ? 'flex-1 min-h-0' : ''} ${className}`}
        style={fillHeight ? undefined : { maxHeight }}
        role="tree"
        aria-label={ariaLabel}
      >
        <div style={{ height: totalH, position: 'relative' }}>
          <div style={{ paddingTop, paddingBottom }}>
            {slice.map((row) => {
              if (row.type === 'loading') {
                return (
                  <div
                    key={row.id}
                    role="treeitem"
                    style={{
                      height: rowHeight,
                      paddingLeft: `${row.depth * 10 + 8}px`,
                    }}
                    className="flex items-center gap-1.5 text-[11px] text-muted"
                  >
                    <Loader2 size={12} className="animate-spin shrink-0" aria-hidden />
                    <span>{row.label}</span>
                  </div>
                );
              }

              if (row.type === 'empty') {
                return (
                  <div
                    key={row.id}
                    role="treeitem"
                    aria-disabled
                    style={{
                      height: rowHeight,
                      paddingLeft: `${row.depth * 10 + 8}px`,
                    }}
                    className="flex items-center gap-1.5 text-[11px] italic text-muted cursor-default select-none"
                  >
                    <span className="w-3.5 shrink-0" aria-hidden />
                    <span>{row.label}</span>
                  </div>
                );
              }

              const { node, depth } = row;
              const isDir = node.kind === 'directory';
              const change = lookup(row.id);
              const selected = selectedPath != null && selectedPath === row.id;
              const dim = dimUnchanged && !change;

              return (
                <button
                  key={row.id}
                  type="button"
                  role="treeitem"
                  aria-expanded={isDir ? !!node.isOpen : undefined}
                  data-change-state={change?.state || 'unchanged'}
                  onClick={() => onRowClick(row)}
                  style={{
                    height: rowHeight,
                    paddingLeft: `${depth * 10 + 8}px`,
                  }}
                  className={`flex w-full items-center gap-1.5 pr-2 text-left text-[13px] border-none bg-transparent font-inherit cursor-pointer ${
                    selected ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'
                  } ${dim ? 'opacity-40 text-muted' : 'text-main'}`}
                >
                  {change ? (
                    <span
                      className={`w-3 shrink-0 text-center text-[11px] font-bold ${changeColorClass(change.state)}`}
                      title={change.state}
                      aria-label={change.state}
                    >
                      {glyphForChangeState(change.state)}
                    </span>
                  ) : (
                    <span className="w-3 shrink-0" aria-hidden />
                  )}
                  {isDir ? (
                    <>
                      {node.isOpen ? (
                        <ChevronDown size={14} className="shrink-0 text-muted opacity-50" aria-hidden />
                      ) : (
                        <ChevronRight size={14} className="shrink-0 text-muted opacity-50" aria-hidden />
                      )}
                      <Folder size={14} className="shrink-0 text-[var(--solar-blue)]" aria-hidden />
                    </>
                  ) : (
                    <>
                      <span className="w-3.5 shrink-0" aria-hidden />
                      <SetiFileIcon filename={node.name} size={14} />
                    </>
                  )}
                  <span className="truncate min-w-0 flex-1" title={node.name}>
                    {node.name}
                  </span>
                  {change && widthBand !== 'narrow' && change.hashShort ? (
                    <span
                      className="ml-auto shrink-0 text-[9px] font-mono text-muted/80 tabular-nums"
                      title={change.hashShort}
                    >
                      {change.hashShort}
                    </span>
                  ) : null}
                  {change && widthBand === 'wide' ? (
                    <span className={`shrink-0 text-[9px] uppercase tracking-wide ${changeColorClass(change.state)}`}>
                      {change.state}
                    </span>
                  ) : null}
                  {isDir && node.loading ? (
                    <Loader2 size={12} className="ml-auto shrink-0 animate-spin text-muted" aria-hidden />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="shrink-0 px-2 py-0.5 text-[9px] text-muted border-t border-[var(--border-subtle)]/40">
        {entryCount.toLocaleString()} visible
        {entryCount > 500 ? ' — expand folders as needed' : ''}
      </p>
    </div>
  );
};
