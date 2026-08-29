import { detectFileKind } from '../fileKind';
import {
  GOOGLE_APPS_MIME,
  isGoogleAppsMime,
} from './driveMimeTypes';
import type { LibraryDisplayKind } from './types';

export function inferDisplayKind(input: {
  name: string;
  mimeType?: string | null;
  artifactType?: string | null;
  isFolder?: boolean;
}): LibraryDisplayKind {
  if (input.isFolder) return 'folder';

  const mime = String(input.mimeType || '');
  if (mime === GOOGLE_APPS_MIME.FOLDER) return 'folder';
  if (mime === GOOGLE_APPS_MIME.SPREADSHEET) return 'spark';
  if (mime === GOOGLE_APPS_MIME.PRESENTATION) return 'pdf';
  if (isGoogleAppsMime(mime)) return 'doc';

  const artifactType = String(input.artifactType || '').toLowerCase();
  const name = input.name || '';

  if (artifactType.includes('glb') || artifactType === '3d' || /\.(glb|gltf)$/i.test(name)) return 'glb';
  if (artifactType === 'html' || artifactType.includes('markdown') || artifactType === 'document') return 'doc';

  const fk = detectFileKind({ name, contentType: input.mimeType ?? undefined });
  if (fk === 'image') return 'photo';
  if (fk === 'pdf') return 'pdf';
  if (fk === 'video') return 'video';
  if (/\.(py|js|ts|tsx|jsx|sql|css|json|sh|yaml|yml)$/i.test(name)) return 'spark';

  return 'doc';
}
