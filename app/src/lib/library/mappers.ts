import type { ArtifactRecord } from '../../../client-api/artifacts';
import { formatModifiedLabel } from './formatLibrary';
import { inferDisplayKind } from './inferDisplayKind';
import type { DriveApiFile } from './libraryApi';
import { isDriveFolder } from './libraryApi';
import type { LibraryItem } from './types';
import type { R2ObjectRow } from '../r2Listing';
import { folderDisplayName } from './formatLibrary';
import type { LocalFileNode } from '../localFileTree';

export function mapArtifactRecord(a: ArtifactRecord): LibraryItem {
  const displayKind = inferDisplayKind({
    name: a.name,
    artifactType: a.artifact_type,
  });
  const modifiedAt = a.updated_at ?? a.created_at ?? undefined;
  return {
    id: `artifacts:${a.id ?? a.r2_key}`,
    source: 'artifacts',
    nativeId: a.id ?? a.r2_key,
    name: a.name,
    kind: 'file',
    displayKind,
    previewUrl: a.preview_url ?? a.thumbnail_url ?? undefined,
    rawUrl: a.public_url ?? undefined,
    modifiedAt: modifiedAt ?? undefined,
    modifiedLabel: a.updated_at_display ?? a.created_at_display ?? formatModifiedLabel(modifiedAt),
    size: a.file_size_bytes ?? undefined,
    ownerName: a.workspace_slug ?? undefined,
    metadata: {
      r2_key: a.r2_key,
      artifact_type: a.artifact_type,
      artifact_status: a.artifact_status,
      source_session_id: a.source_session_id,
    },
    artifact: a,
  };
}

export function mapDriveFile(
  file: DriveApiFile,
  driveView?: string,
  activeSharedDriveId?: string | null,
): LibraryItem {
  const folder = isDriveFolder(file);
  const isImage =
    (file.mimeType || '').startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || '');
  const previewUrl =
    file.thumbnailLink ||
    (isImage ? `/api/integrations/gdrive/raw?fileId=${encodeURIComponent(file.id)}` : undefined);

  const isSharedDriveRoot =
    driveView === 'shared-drives' && folder && !!file.driveId && file.id === file.driveId;

  return {
    id: `drive:${file.id}`,
    source: 'drive',
    nativeId: file.id,
    name: file.name,
    kind: folder ? 'folder' : 'file',
    displayKind: folder ? 'folder' : inferDisplayKind({ name: file.name, mimeType: file.mimeType }),
    mimeType: file.mimeType,
    previewUrl,
    rawUrl: file.webViewLink ?? `/api/integrations/gdrive/raw?fileId=${encodeURIComponent(file.id)}`,
    modifiedAt: file.modifiedTime,
    modifiedLabel: formatModifiedLabel(file.modifiedTime),
    size: file.size ? Number(file.size) : undefined,
    ownerName: file.owners?.[0]?.displayName ?? file.owners?.[0]?.emailAddress,
    starred: file.starred,
    trashed: file.trashed,
    metadata: {
      driveFileId: file.id,
      driveId: file.driveId ?? activeSharedDriveId ?? undefined,
      isSharedDriveRoot,
      driveView,
    },
  };
}

export function mapR2FolderPrefix(bucket: string, prefix: string): LibraryItem {
  const name = folderDisplayName(prefix) || prefix;
  return {
    id: `r2:${bucket}:${prefix}`,
    source: 'r2',
    nativeId: prefix,
    name,
    kind: 'folder',
    displayKind: 'folder',
    modifiedLabel: '—',
    metadata: { bucket, prefix },
  };
}

export function mapR2Object(bucket: string, obj: R2ObjectRow): LibraryItem {
  const name = obj.key.split('/').filter(Boolean).pop() || obj.key;
  const rawUrl = `/api/r2/file?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(obj.key)}`;
  const isImage = /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(name);
  return {
    id: `r2:${bucket}:${obj.key}`,
    source: 'r2',
    nativeId: obj.key,
    name,
    kind: 'file',
    displayKind: inferDisplayKind({ name }),
    previewUrl: isImage ? rawUrl : undefined,
    rawUrl,
    modifiedAt: obj.last_modified ?? undefined,
    modifiedLabel: formatModifiedLabel(obj.last_modified),
    size: obj.size,
    metadata: { bucket, key: obj.key },
  };
}

export function mapLocalNode(node: LocalFileNode, path: string): LibraryItem {
  const idPath = path ? `${path}/${node.name}` : node.name;
  return {
    id: `local:${idPath}`,
    source: 'local',
    nativeId: idPath,
    name: node.name,
    kind: node.kind === 'directory' ? 'folder' : 'file',
    displayKind:
      node.kind === 'directory'
        ? 'folder'
        : inferDisplayKind({ name: node.name }),
    modifiedLabel: 'Local',
    metadata: { path: idPath, handleKind: node.kind },
  };
}

export function sortLibraryItems(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
