import { getAccessToken, googleSignIn } from './googleAuth';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  parents?: string[];
  starred?: boolean;
  trashed?: boolean;
  owners?: Array<{
    displayName: string;
    emailAddress: string;
    photoLink?: string;
  }>;
}

export interface ListFilesOptions {
  folderId?: string;
  searchTerm?: string;
  mimeTypeFilter?: string;
  pageToken?: string;
  pageSize?: number;
  orderBy?: string;
}

export interface ListFilesResponse {
  files: DriveFileItem[];
  nextPageToken?: string;
}

/**
 * Ensures an active access token is available, prompting sign-in if needed.
 */
async function ensureToken(): Promise<string> {
  let token = await getAccessToken();
  if (!token) {
    const res = await googleSignIn();
    if (!res?.accessToken) {
      throw new Error('Please sign in with Google to access your Google Drive.');
    }
    token = res.accessToken;
  }
  return token;
}

/**
 * List files and folders from Google Drive.
 */
export async function listDriveFiles(options: ListFilesOptions = {}): Promise<ListFilesResponse> {
  const token = await ensureToken();
  const {
    folderId,
    searchTerm,
    mimeTypeFilter,
    pageToken,
    pageSize = 30,
    orderBy = 'folder,modifiedTime desc',
  } = options;

  const queries: string[] = ['trashed = false'];

  if (folderId) {
    queries.push(`'${folderId}' in parents`);
  } else if (!searchTerm) {
    queries.push(`'root' in parents`);
  }

  if (searchTerm && searchTerm.trim()) {
    const escaped = searchTerm.replace(/'/g, "\\'");
    queries.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
  }

  if (mimeTypeFilter && mimeTypeFilter !== 'all') {
    if (mimeTypeFilter === 'folder') {
      queries.push(`mimeType = 'application/vnd.google-apps.folder'`);
    } else if (mimeTypeFilter === 'document') {
      queries.push(`(mimeType = 'application/vnd.google-apps.document' or mimeType = 'text/plain' or mimeType = 'text/markdown' or mimeType = 'text/html' or mimeType = 'application/pdf')`);
    } else if (mimeTypeFilter === 'spreadsheet') {
      queries.push(`(mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'text/csv')`);
    } else if (mimeTypeFilter === 'presentation') {
      queries.push(`mimeType = 'application/vnd.google-apps.presentation'`);
    } else if (mimeTypeFilter === 'image') {
      queries.push(`mimeType contains 'image/'`);
    }
  }

  const q = queries.join(' and ');
  const fields = 'nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, webViewLink, webContentLink, iconLink, thumbnailLink, parents, starred, trashed, owners(displayName, emailAddress, photoLink))';

  const params = new URLSearchParams({
    q,
    fields,
    pageSize: String(pageSize),
    orderBy,
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to list Drive files (${res.status})`);
  }

  const data = await res.json();
  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
  };
}

/**
 * Get metadata for a specific file or folder.
 */
export async function getDriveFileMetadata(fileId: string): Promise<DriveFileItem> {
  const token = await ensureToken();
  const fields = 'id, name, mimeType, size, modifiedTime, createdTime, webViewLink, webContentLink, iconLink, thumbnailLink, parents, starred, trashed, owners(displayName, emailAddress, photoLink)';
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=${fields}&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to fetch file metadata (${res.status})`);
  }

  return await res.json();
}

/**
 * Read text content of a Drive file or export Google Docs.
 */
export async function readDriveFileContent(file: DriveFileItem): Promise<string> {
  const token = await ensureToken();

  // If it's a Google Workspace document, export it
  if (file.mimeType === 'application/vnd.google-apps.document') {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to export Google Doc: ${res.statusText}`);
    return await res.text();
  }

  if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to export Google Sheet: ${res.statusText}`);
    return await res.text();
  }

  // Standard text/html/code files download
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to read file content: ${res.statusText}`);
  }

  return await res.text();
}

/**
 * Create a new folder in Google Drive.
 */
export async function createDriveFolder(name: string, parentFolderId?: string): Promise<DriveFileItem> {
  const token = await ensureToken();
  const metadata: any = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };

  if (parentFolderId && parentFolderId !== 'root') {
    metadata.parents = [parentFolderId];
  }

  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to create folder');
  }

  return await res.json();
}

/**
 * Upload text/HTML/data file into Google Drive with multipart upload.
 */
export async function uploadDriveFile(
  name: string,
  content: string,
  mimeType: string = 'text/html',
  parentFolderId?: string
): Promise<DriveFileItem> {
  const token = await ensureToken();

  const metadata: any = {
    name,
    mimeType,
  };

  if (parentFolderId && parentFolderId !== 'root') {
    metadata.parents = [parentFolderId];
  }

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n\r\n` +
    content +
    closeDelimiter;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to upload file (${res.status})`);
  }

  return await res.json();
}

/**
 * Delete a file or folder permanently from Google Drive.
 */
export async function deleteDriveFile(fileId: string): Promise<boolean> {
  const token = await ensureToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to delete file from Google Drive');
  }

  return true;
}
