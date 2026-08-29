import type { WorkspaceId, WorkspaceLayout } from './cadStudioTypes';

const ANIM_LIB_COL = 'minmax(220px, 300px)';
const RIGHT_COL = '260px';
const VIEW_COL = 'minmax(0, 1fr)';
const TIMELINE_ROW = 'minmax(72px, 120px)';

/** Production layouts — anim library left, viewport center, right rail optional. */
export const WORKSPACE_LAYOUTS: Record<WorkspaceId, WorkspaceLayout> = {
  Layout: {
    id: 'Layout',
    gridTemplateAreas: `
      "animLib viewport right"
      "animLib viewport right"
      "animLib timeline timeline"
    `,
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} ${RIGHT_COL}`,
    gridTemplateRows: `minmax(0, 1fr) minmax(0, 1fr) ${TIMELINE_ROW}`,
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'rightTabs', area: 'right' },
      { editor: 'timeline', area: 'timeline' },
    ],
  },
  Modeling: {
    id: 'Modeling',
    gridTemplateAreas: `
      "animLib viewport right"
      "animLib viewport right"
      "animLib creation creation"
    `,
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr) minmax(140px, 200px)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'rightTabs', area: 'right' },
      { editor: 'creationPanel', area: 'creation' },
    ],
  },
  Sculpting: {
    id: 'Sculpting',
    gridTemplateAreas: '"animLib viewport right" "animLib viewport right"',
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'rightTabs', area: 'right' },
    ],
  },
  'UV Editing': {
    id: 'UV Editing',
    gridTemplateAreas: '"animLib uv viewport right" "animLib uv viewport right"',
    gridTemplateColumns: `${ANIM_LIB_COL} minmax(160px, 220px) ${VIEW_COL} ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewportSecondary', area: 'uv' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'rightTabs', area: 'right' },
    ],
  },
  'Texture Paint': {
    id: 'Texture Paint',
    gridTemplateAreas: '"animLib viewport image right" "animLib viewport image right"',
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} minmax(160px, 220px) ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'viewportSecondary', area: 'image' },
      { editor: 'rightTabs', area: 'right' },
    ],
  },
  Shading: {
    id: 'Shading',
    gridTemplateAreas: '"animLib nodes viewport right" "animLib nodes viewport right"',
    gridTemplateColumns: `${ANIM_LIB_COL} minmax(180px, 240px) ${VIEW_COL} ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'nodes', area: 'nodes' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'rightTabs', area: 'right' },
    ],
  },
  Animation: {
    id: 'Animation',
    gridTemplateAreas: `
      "animLib viewport cam right"
      "animLib viewport cam right"
      "animLib timeline timeline timeline"
    `,
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} ${VIEW_COL} ${RIGHT_COL}`,
    gridTemplateRows: `minmax(0, 1fr) minmax(0, 1fr) ${TIMELINE_ROW}`,
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'viewportSecondary', area: 'cam' },
      { editor: 'rightTabs', area: 'right' },
      { editor: 'timeline', area: 'timeline' },
    ],
  },
  Rendering: {
    id: 'Rendering',
    gridTemplateAreas: '"animLib viewport render right" "animLib viewport render right"',
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} ${VIEW_COL} ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'viewportSecondary', area: 'render' },
      { editor: 'rightTabs', area: 'right' },
    ],
  },
  Compositing: {
    id: 'Compositing',
    gridTemplateAreas: '"animLib viewport comp right" "animLib viewport comp right"',
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} ${VIEW_COL} ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'viewportSecondary', area: 'comp' },
      { editor: 'rightTabs', area: 'right' },
    ],
  },
  'Geometry Nodes': {
    id: 'Geometry Nodes',
    gridTemplateAreas: '"animLib viewport script right" "animLib viewport script right"',
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} minmax(200px, 280px) ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'script', area: 'script' },
      { editor: 'rightTabs', area: 'right' },
    ],
  },
  Scripting: {
    id: 'Scripting',
    gridTemplateAreas: '"animLib script viewport" "animLib script viewport"',
    gridTemplateColumns: `${ANIM_LIB_COL} minmax(260px, 320px) ${VIEW_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'script', area: 'script' },
      { editor: 'viewport', area: 'viewport' },
    ],
  },
  'Motion Tracking': {
    id: 'Motion Tracking',
    gridTemplateAreas: `
      "animLib clip graph right"
      "animLib viewport viewport right"
      "animLib timeline timeline timeline"
    `,
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} ${VIEW_COL} ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(100px, 160px) minmax(0, 1fr) ' + TIMELINE_ROW,
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'movieClip', area: 'clip' },
      { editor: 'graph', area: 'graph' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'rightTabs', area: 'right' },
      { editor: 'timeline', area: 'timeline' },
    ],
  },
  'Video Editing': {
    id: 'Video Editing',
    gridTemplateAreas: `
      "animLib viewport preview right"
      "animLib sequencer scopes right"
    `,
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} minmax(160px, 220px) ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(120px, 180px)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'viewportSecondary', area: 'preview' },
      { editor: 'sequencer', area: 'sequencer' },
      { editor: 'scopes', area: 'scopes' },
      { editor: 'rightTabs', area: 'right' },
    ],
  },
  '2D Animation': {
    id: '2D Animation',
    gridTemplateAreas: `
      "animLib viewport layers right"
      "animLib timeline timeline right"
    `,
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} minmax(140px, 200px) ${RIGHT_COL}`,
    gridTemplateRows: `minmax(0, 1fr) ${TIMELINE_ROW}`,
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'greaseLayers', area: 'layers' },
      { editor: 'timeline', area: 'timeline' },
      { editor: 'rightTabs', area: 'right' },
    ],
  },
  Agent: {
    id: 'Agent',
    gridTemplateAreas: '"animLib viewport right" "animLib viewport right"',
    gridTemplateColumns: `${ANIM_LIB_COL} ${VIEW_COL} ${RIGHT_COL}`,
    gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
    cells: [
      { editor: 'animationLibrary', area: 'animLib' },
      { editor: 'viewport', area: 'viewport' },
      { editor: 'rightTabs', area: 'right' },
    ],
  },
};

export function getLayoutForWorkspace(ws: WorkspaceId): WorkspaceLayout {
  return WORKSPACE_LAYOUTS[ws] ?? WORKSPACE_LAYOUTS.Layout;
}

type PanelVisibilityLike = {
  outliner: boolean;
  properties: boolean;
  assets: boolean;
  timeline: boolean;
  animationLibrary: boolean;
};

function parseAreaLines(areas: string): string[] {
  return areas
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseAreaRow(line: string): string[] {
  const inner = line.replace(/^"+|"+$/g, '').trim();
  return inner.split(/\s+/).filter(Boolean);
}

function formatAreaRow(parts: string[]): string {
  return `"${parts.join(' ')}"`;
}

/** Remove one named column from grid areas and normalize row widths. */
function stripAreaColumn(areas: string, areaToRemove: string): string {
  const rows = parseAreaLines(areas).map((line) =>
    parseAreaRow(line).filter((cell) => cell !== areaToRemove),
  );
  const colCount = Math.max(1, ...rows.map((parts) => parts.length));
  const normalized = rows.map((parts) => {
    if (parts.length === 0) return [areaToRemove];
    const padded = [...parts];
    const fill = padded[padded.length - 1];
    while (padded.length < colCount) padded.push(fill);
    if (padded.length > colCount) padded.length = colCount;
    return padded;
  });
  return normalized.map(formatAreaRow).join('\n');
}

function stripLastColumn(columns: string): string {
  const parts = columns.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? VIEW_COL;
  return parts.slice(0, -1).join(' ');
}

function stripFirstColumn(columns: string): string {
  const parts = columns.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? VIEW_COL;
  return parts.slice(1).join(' ');
}

/** Collapse empty grid columns when panels are hidden — prevents orphan columns / blown timelines. */
export function adjustLayoutForVisibility(
  layout: WorkspaceLayout,
  panelVisibility: PanelVisibilityLike,
): WorkspaceLayout {
  const rightHidden =
    !panelVisibility.outliner && !panelVisibility.properties && !panelVisibility.assets;
  const timelineHidden = !panelVisibility.timeline;
  const animLibHidden = !panelVisibility.animationLibrary;

  let areas = layout.gridTemplateAreas.trim();
  let columns = layout.gridTemplateColumns.trim();
  let rows = layout.gridTemplateRows.trim();

  if (rightHidden) {
    areas = stripAreaColumn(areas, 'right');
    columns = stripLastColumn(columns);
  }

  if (animLibHidden) {
    areas = stripAreaColumn(areas, 'animLib');
    columns = stripFirstColumn(columns);
  }

  if (timelineHidden) {
    const lines = parseAreaLines(areas).filter((line) => !parseAreaRow(line).includes('timeline'));
    areas = lines.join('\n').trim();
    const rowParts = rows.split(/\s+/);
    if (rowParts.length >= 2) {
      rows = rowParts.slice(0, -1).join(' ');
    }
  }

  if (
    areas === layout.gridTemplateAreas.trim() &&
    columns === layout.gridTemplateColumns.trim() &&
    rows === layout.gridTemplateRows.trim()
  ) {
    return layout;
  }

  return {
    ...layout,
    gridTemplateAreas: areas,
    gridTemplateColumns: columns,
    gridTemplateRows: rows,
  };
}
