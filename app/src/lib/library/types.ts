import type { ArtifactRecord } from '../../../client-api/artifacts';

export type LibrarySource = 'artifacts' | 'drive' | 'r2' | 'local';

export type DriveView = 'my-drive' | 'shared-with-me' | 'shared-drives' | 'shared-drive' | 'trash' | 'starred';

export type LibraryRail =
  | 'all'
  | 'artifacts'
  | 'projects'
  | 'tickets'
  | 'drive'
  | 'r2'
  | 'local'
  | 'recent'
  | 'starred'
  | 'trash';

/** Visual thumb kind — matches Drive prototype cards. */
export type LibraryDisplayKind = 'folder' | 'doc' | 'spark' | 'photo' | 'pdf' | 'glb' | 'video' | 'file';

export type LibraryItemKind = 'folder' | 'file';

export interface LibraryItem {
  id: string;
  source: LibrarySource;
  nativeId: string;
  name: string;
  kind: LibraryItemKind;
  displayKind: LibraryDisplayKind;
  mimeType?: string;
  previewUrl?: string;
  rawUrl?: string;
  modifiedAt?: string;
  modifiedLabel?: string;
  size?: number;
  ownerName?: string;
  starred?: boolean;
  trashed?: boolean;
  /** Provider-specific payload (Drive file id, R2 key, FS handle, artifact row). */
  metadata?: Record<string, unknown>;
  artifact?: ArtifactRecord;
}

export type SourceFilter = 'all' | LibrarySource;

export interface LibraryFilters {
  query: string;
  rail: LibraryRail;
  source: SourceFilter;
  type: LibraryDisplayKind | 'all';
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  query: '',
  rail: 'all',
  source: 'all',
  type: 'all',
};

export interface ListLibraryParams {
  rail: LibraryRail;
  query?: string;
  sessionId?: string;
  signal?: AbortSignal;
  driveFolderId: string;
  driveView: DriveView;
  sharedDriveId: string | null;
  r2Bucket: string;
  r2Prefix: string;
  localDirHandle: FileSystemDirectoryHandle | null;
  localPath: string;
}

export interface LibraryListResult {
  items: LibraryItem[];
  error?: string;
  driveConnected?: boolean;
}

export interface LibraryProvider {
  source: LibrarySource;
  label: string;
  list(params: ListLibraryParams): Promise<LibraryListResult>;
}

export const RAIL_TITLES: Record<LibraryRail, string> = {
  all: 'All sources',
  artifacts: 'My artifacts',
  projects: 'Projects',
  tickets: 'Tickets',
  drive: 'Google Drive',
  r2: 'R2 Storage',
  local: 'Local folder',
  recent: 'Recent',
  starred: 'Starred',
  trash: 'Trash',
};

export const NAV_RAIL_MAP: Record<string, LibraryRail> = {
  home: 'all',
  artifacts: 'artifacts',
  projects: 'projects',
  tickets: 'tickets',
  workspaces: 'r2',
  'my-drive': 'drive',
  shared: 'drive',
  'shared-with-me': 'drive',
  computers: 'local',
  recent: 'recent',
  starred: 'starred',
  trash: 'trash',
};

export const NAV_DRIVE_VIEW: Record<string, DriveView> = {
  'my-drive': 'my-drive',
  shared: 'shared-drives',
  'shared-with-me': 'shared-with-me',
  trash: 'trash',
  starred: 'starred',
};
