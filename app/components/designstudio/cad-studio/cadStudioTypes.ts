/** IAM CAD Studio — shared types for workspace layouts and UI state. */

export const WORKSPACE_IDS = [
  'Layout',
  'Modeling',
  'Sculpting',
  'UV Editing',
  'Texture Paint',
  'Shading',
  'Animation',
  'Rendering',
  'Compositing',
  'Geometry Nodes',
  'Scripting',
  'Motion Tracking',
  'Video Editing',
  '2D Animation',
  'Agent',
] as const;

export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export type InteractionMode = 'object' | 'edit' | 'sculpt' | 'pose' | 'draw';

export type ViewTool = 'select' | 'move' | 'rotate' | 'scale';

export type EditorId =
  | 'viewport'
  | 'viewportSecondary'
  | 'animationLibrary'
  | 'outliner'
  | 'properties'
  | 'assets'
  | 'rightTabs'
  | 'toolShelf'
  | 'timeline'
  | 'dopesheet'
  | 'nodes'
  | 'script'
  | 'movieClip'
  | 'graph'
  | 'sequencer'
  | 'scopes'
  | 'colorBalance'
  | 'greaseLayers'
  | 'creationPanel';

export type LayoutCell = {
  editor: EditorId;
  area: string;
};

export type WorkspaceLayout = {
  id: WorkspaceId;
  gridTemplateAreas: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;
  cells: LayoutCell[];
};

export type PanelVisibility = {
  animationLibrary: boolean;
  outliner: boolean;
  properties: boolean;
  assets: boolean;
  timeline: boolean;
  toolShelf: boolean;
  chat: boolean;
};

export type RightPanelTab = 'outliner' | 'assets' | 'properties';

export type PropertiesTabId =
  | 'object'
  | 'modifiers'
  | 'material'
  | 'data'
  | 'world'
  | 'render'
  | 'scene'
  | 'physics';

export type MeshStats = {
  verts: number;
  edges: number;
  faces: number;
  tris: number;
};

export type GalleryItem = {
  id: string;
  name: string;
  url: string;
  thumbnail?: string | null;
  source: 'stock' | 'mine' | 'job' | 'meshy';
  scale?: number;
  createdAt?: number;
  /** Non-terminal CAD/Meshy job — card shows progress, no GLB spawn until ready */
  pending?: boolean;
  status?: string;
  progressPct?: number;
  cadJobId?: string;
  externalTaskId?: string;
  taskType?: string;
};

export type CadStudioUiState = {
  workspace: WorkspaceId;
  interactionMode: InteractionMode;
  viewTool: ViewTool;
  rightPanelTab: RightPanelTab;
  propertiesTab: PropertiesTabId;
  panelVisibility: PanelVisibility;
  wireframe: boolean;
  solidShading: boolean;
  frame: number;
  endFrame: number;
  isPlaying: boolean;
};

export const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  animationLibrary: false,
  outliner: false,
  properties: false,
  assets: false,
  timeline: false,
  toolShelf: false,
  chat: true,
};

export const DEFAULT_UI_STATE: CadStudioUiState = {
  workspace: 'Layout',
  interactionMode: 'object',
  viewTool: 'select',
  rightPanelTab: 'outliner',
  propertiesTab: 'object',
  panelVisibility: DEFAULT_PANEL_VISIBILITY,
  wireframe: false,
  solidShading: true,
  frame: 1,
  endFrame: 250,
  isPlaying: false,
};
