/** Google Drive v3 file operations client (Library + agent tools). */

export async function createDriveFolder(name: string, parentId?: string): Promise<{ ok: boolean; file?: unknown; error?: string }> {
  try {
    const res = await fetch('/api/integrations/gdrive/files', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parentId: parentId && parentId !== 'root' ? parentId : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Create folder failed') };
    return { ok: true, file: data.file };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Create folder failed' };
  }
}

export async function uploadDriveFiles(
  files: FileList | File[],
  parentId?: string,
): Promise<{ ok: boolean; uploaded: number; error?: string }> {
  const list = Array.from(files);
  if (!list.length) return { ok: false, uploaded: 0, error: 'No files selected' };
  let uploaded = 0;
  for (const file of list) {
    const form = new FormData();
    form.append('file', file);
    form.append('name', file.name);
    if (parentId && parentId !== 'root') form.append('parentId', parentId);
    const res = await fetch('/api/integrations/gdrive/files', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, uploaded, error: String(data.error || `Upload failed: ${file.name}`) };
    uploaded += 1;
  }
  return { ok: true, uploaded };
}

export async function renameDriveFile(fileId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Rename failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Rename failed' };
  }
}

export async function copyDriveFile(
  fileId: string,
  opts?: { name?: string; parentId?: string },
): Promise<{ ok: boolean; file?: unknown; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}/copy`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: opts?.name,
        parents: opts?.parentId ? [opts.parentId] : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Copy failed') };
    return { ok: true, file: data.file };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Copy failed' };
  }
}

export async function trashDriveFile(fileId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}/trash`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Trash failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Trash failed' };
  }
}

export async function restoreDriveFile(fileId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}/untrash`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Restore failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Restore failed' };
  }
}

export async function deleteDriveFilePermanent(fileId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Delete failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed' };
  }
}

export async function emptyDriveTrash(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/integrations/gdrive/trash', { method: 'DELETE', credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Empty trash failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Empty trash failed' };
  }
}

export async function listDriveComments(fileId: string): Promise<{ ok: boolean; comments?: unknown[]; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}/comments`, {
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'List comments failed') };
    return { ok: true, comments: (data.comments as unknown[]) || [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'List comments failed' };
  }
}

export async function addDriveComment(fileId: string, content: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}/comments`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Add comment failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Add comment failed' };
  }
}

export async function listDriveLabels(fileId: string): Promise<{ ok: boolean; labels?: unknown; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}/labels`, {
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'List labels failed') };
    return { ok: true, labels: data.labels };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'List labels failed' };
  }
}

export async function modifyDriveLabels(
  fileId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}/labels`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Modify labels failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Modify labels failed' };
  }
}

export async function getDriveChangesStartToken(driveId?: string): Promise<{ ok: boolean; startPageToken?: string; error?: string }> {
  try {
    const qs = driveId ? `?driveId=${encodeURIComponent(driveId)}` : '';
    const res = await fetch(`/api/integrations/gdrive/changes/startPageToken${qs}`, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Start page token failed') };
    return { ok: true, startPageToken: String(data.startPageToken || '') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Start page token failed' };
  }
}

export async function listDriveChanges(pageToken: string, driveId?: string): Promise<{ ok: boolean; changes?: unknown[]; error?: string }> {
  try {
    const qs = new URLSearchParams({ pageToken });
    if (driveId) qs.set('driveId', driveId);
    const res = await fetch(`/api/integrations/gdrive/changes?${qs}`, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'List changes failed') };
    return { ok: true, changes: (data.changes as unknown[]) || [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'List changes failed' };
  }
}

export async function watchDriveChanges(body: {
  id: string;
  address: string;
  pageToken: string;
  driveId?: string;
  token?: string;
}): Promise<{ ok: boolean; channel?: unknown; error?: string }> {
  try {
    const res = await fetch('/api/integrations/gdrive/changes/watch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Watch failed') };
    return { ok: true, channel: data.channel };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Watch failed' };
  }
}

export async function listDriveApprovals(fileId: string): Promise<{ ok: boolean; approvals?: unknown[]; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}/approvals`, {
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'List approvals failed') };
    return { ok: true, approvals: (data.approvals as unknown[]) || [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'List approvals failed' };
  }
}

export async function startDriveApproval(fileId: string, body: Record<string, unknown> = {}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/files/${encodeURIComponent(fileId)}/approvals/start`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(data.error || 'Start approval failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Start approval failed' };
  }
}
