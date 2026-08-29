import type { DriveConnectionStatus } from './libraryApi';

export type SharedDriveResource = {
  id: string;
  name: string;
  hidden?: boolean;
  createdTime?: string;
  capabilities?: {
    canAddChildren?: boolean;
    canDeleteDrive?: boolean;
    canRenameDrive?: boolean;
    canShare?: boolean;
  };
};

export type SharedDrivePermission = {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
  displayName?: string;
  deleted?: boolean;
};

export const SHARED_DRIVE_ROLES = [
  { value: 'organizer', label: 'Manager' },
  { value: 'fileOrganizer', label: 'Content manager' },
  { value: 'writer', label: 'Contributor' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'reader', label: 'Viewer' },
] as const;

const DRIVE_MANAGE_SCOPE = 'https://www.googleapis.com/auth/drive';

export function hasDriveManageScope(status: DriveConnectionStatus | null | undefined): boolean {
  const scope = String(status?.scope || '');
  if (!scope) return false;
  return scope.split(/\s+/).includes(DRIVE_MANAGE_SCOPE);
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({}));
}

export async function createSharedDrive(name: string): Promise<{ ok: boolean; drive?: SharedDriveResource; error?: string }> {
  try {
    const res = await fetch('/api/integrations/gdrive/drives', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await parseJson(res);
    if (!res.ok) return { ok: false, error: String(data.error || 'Create failed') };
    return { ok: true, drive: data.drive as SharedDriveResource };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export async function getSharedDrive(driveId: string): Promise<{ ok: boolean; drive?: SharedDriveResource; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/drives/${encodeURIComponent(driveId)}`, {
      credentials: 'same-origin',
    });
    const data = await parseJson(res);
    if (!res.ok) return { ok: false, error: String(data.error || 'Load failed') };
    return { ok: true, drive: data.drive as SharedDriveResource };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Load failed' };
  }
}

export async function updateSharedDrive(
  driveId: string,
  patch: { name?: string },
): Promise<{ ok: boolean; drive?: SharedDriveResource; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/drives/${encodeURIComponent(driveId)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await parseJson(res);
    if (!res.ok) return { ok: false, error: String(data.error || 'Update failed') };
    return { ok: true, drive: data.drive as SharedDriveResource };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export async function hideSharedDrive(driveId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/drives/${encodeURIComponent(driveId)}/hide`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await parseJson(res);
    if (!res.ok) return { ok: false, error: String(data.error || 'Hide failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Hide failed' };
  }
}

export async function unhideSharedDrive(driveId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/drives/${encodeURIComponent(driveId)}/unhide`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await parseJson(res);
    if (!res.ok) return { ok: false, error: String(data.error || 'Unhide failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unhide failed' };
  }
}

export async function deleteSharedDrive(driveId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/drives/${encodeURIComponent(driveId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await parseJson(res);
    if (!res.ok) return { ok: false, error: String(data.error || 'Delete failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed' };
  }
}

export async function listSharedDrivePermissions(
  driveId: string,
): Promise<{ ok: boolean; permissions?: SharedDrivePermission[]; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/drives/${encodeURIComponent(driveId)}/permissions`, {
      credentials: 'same-origin',
    });
    const data = await parseJson(res);
    if (!res.ok) return { ok: false, error: String(data.error || 'List members failed') };
    return { ok: true, permissions: (data.permissions as SharedDrivePermission[]) || [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'List members failed' };
  }
}

export async function addSharedDriveMember(
  driveId: string,
  email: string,
  role: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/integrations/gdrive/drives/${encodeURIComponent(driveId)}/permissions`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    const data = await parseJson(res);
    if (!res.ok) return { ok: false, error: String(data.error || 'Add member failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Add member failed' };
  }
}

export async function removeSharedDriveMember(
  driveId: string,
  permissionId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `/api/integrations/gdrive/drives/${encodeURIComponent(driveId)}/permissions/${encodeURIComponent(permissionId)}`,
      { method: 'DELETE', credentials: 'same-origin' },
    );
    const data = await parseJson(res);
    if (!res.ok) return { ok: false, error: String(data.error || 'Remove member failed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Remove member failed' };
  }
}
