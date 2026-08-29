import React, { useMemo } from 'react';
import type { EditorId, WorkspaceId } from './cadStudioTypes';
import { adjustLayoutForVisibility, getLayoutForWorkspace } from './layoutPresets';

export type WorkspaceLayoutEngineProps = {
  workspace: WorkspaceId;
  panelVisibility: {
    animationLibrary: boolean;
    outliner: boolean;
    properties: boolean;
    assets: boolean;
    timeline: boolean;
    toolShelf: boolean;
  };
  editors: Partial<Record<EditorId, React.ReactNode>>;
  /** Primary viewport grid cell — used to position the persistent 3D engine canvas. */
  onViewportCellMount?: (el: HTMLDivElement | null) => void;
  /** Override height of the bottom timeline row (px). */
  timelineRowHeight?: number | null;
};

/**
 * Split a CSS grid-template-rows/columns string into individual track tokens,
 * respecting nested parentheses (e.g. minmax(0, 1fr) is one token, not two).
 */
function splitCssTracklist(s: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s.trim()) {
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ' ' && depth === 0) {
      if (cur) { tokens.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

export function WorkspaceLayoutEngine({
  workspace,
  panelVisibility,
  editors,
  onViewportCellMount,
  timelineRowHeight = null,
}: WorkspaceLayoutEngineProps) {
  const layout = useMemo(() => {
    const base = getLayoutForWorkspace(workspace);
    const adjusted = adjustLayoutForVisibility(base, panelVisibility);
    if (timelineRowHeight != null && adjusted.cells.some((c) => c.editor === 'timeline')) {
      const rows = splitCssTracklist(adjusted.gridTemplateRows);
      if (rows.length > 0) {
        rows[rows.length - 1] = `${timelineRowHeight}px`;
        return { ...adjusted, gridTemplateRows: rows.join(' ') };
      }
    }
    return adjusted;
  }, [workspace, panelVisibility, timelineRowHeight]);

  const areaGroups = useMemo(() => {
    const hidden = new Set<EditorId>();
    if (!panelVisibility.toolShelf) hidden.add('toolShelf');
    if (!panelVisibility.animationLibrary) hidden.add('animationLibrary');
    if (!panelVisibility.outliner) hidden.add('outliner');
    if (!panelVisibility.properties) hidden.add('properties');
    if (!panelVisibility.assets) hidden.add('assets');
    if (!panelVisibility.outliner && !panelVisibility.properties && !panelVisibility.assets) {
      hidden.add('rightTabs');
    }
    if (!panelVisibility.timeline) {
      hidden.add('timeline');
      hidden.add('dopesheet');
    }

    const groups = new Map<string, EditorId[]>();
    for (const cell of layout.cells) {
      if (hidden.has(cell.editor)) continue;
      const list = groups.get(cell.area) ?? [];
      list.push(cell.editor);
      groups.set(cell.area, list);
    }
    return groups;
  }, [layout, panelVisibility]);

  const style: React.CSSProperties = {
    display: 'grid',
    gridTemplateAreas: layout.gridTemplateAreas,
    gridTemplateColumns: layout.gridTemplateColumns,
    gridTemplateRows: layout.gridTemplateRows,
    minHeight: 0,
    flex: 1,
    width: '100%',
  };

  return (
    <main className="cad-studio__layout-engine" style={style}>
      {Array.from(areaGroups.entries()).map(([area, editorIds]) => {
        const nodes = editorIds.map((id) => editors[id]).filter(Boolean);
        if (nodes.length === 0) return null;
        const isViewport = area === 'viewport';
        return (
          <div
            key={area}
            ref={isViewport ? onViewportCellMount : undefined}
            data-area={area}
            className={`cad-studio__layout-cell${nodes.length > 1 ? ' cad-studio__layout-cell--stack' : ''}${isViewport ? ' cad-studio__layout-cell--viewport' : ''}`}
            style={{ gridArea: area }}
          >
            {nodes.map((node, i) => (
              <div key={editorIds[i]} className="cad-studio__layout-stack-item">
                {node}
              </div>
            ))}
          </div>
        );
      })}
    </main>
  );
}
