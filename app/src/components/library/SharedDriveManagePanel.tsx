import { useCallback, useEffect, useState } from 'react';
import type { DriveConnectionStatus } from '../../lib/library/libraryApi';
import { connectGoogleDriveForManage } from '../../lib/library/libraryApi';
import {
  SHARED_DRIVE_ROLES,
  addSharedDriveMember,
  deleteSharedDrive,
  getSharedDrive,
  hasDriveManageScope,
  hideSharedDrive,
  listSharedDrivePermissions,
  removeSharedDriveMember,
  unhideSharedDrive,
  updateSharedDrive,
  type SharedDrivePermission,
  type SharedDriveResource,
} from '../../lib/library/sharedDriveApi';

type Props = {
  driveId: string;
  driveName: string;
  driveStatus: DriveConnectionStatus | null;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
  onToast: (msg: string) => void;
};

export function SharedDriveManagePanel({
  driveId,
  driveName,
  driveStatus,
  onClose,
  onUpdated,
  onDeleted,
  onToast,
}: Props) {
  const canManage = hasDriveManageScope(driveStatus);
  const [drive, setDrive] = useState<SharedDriveResource | null>(null);
  const [permissions, setPermissions] = useState<SharedDrivePermission[]>([]);
  const [nameDraft, setNameDraft] = useState(driveName);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('reader');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [driveOut, permOut] = await Promise.all([getSharedDrive(driveId), listSharedDrivePermissions(driveId)]);
    if (!driveOut.ok) setError(driveOut.error || 'Could not load shared drive');
    else {
      setDrive(driveOut.drive || null);
      setNameDraft(driveOut.drive?.name || driveName);
    }
    if (permOut.ok) setPermissions((permOut.permissions || []).filter((p) => !p.deleted && p.type !== 'anyone'));
    else if (!driveOut.error) setError(permOut.error || 'Could not load members');
    setLoading(false);
  }, [driveId, driveName]);

  useEffect(() => {
    if (canManage) void reload();
    else setLoading(false);
  }, [canManage, reload]);

  const runAction = async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      if (!out.ok) {
        setError(out.error || `${label} failed`);
        onToast(out.error || `${label} failed`);
        return;
      }
      onToast(`${label} succeeded`);
      onUpdated();
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return (
      <aside className="shared-drive-panel">
        <div className="shared-drive-panel-head">
          <strong>Manage shared drive</strong>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="shared-drive-panel-body">
          <p className="shared-drive-hint">
            Creating and managing shared drives requires full Google Drive access. Reconnect with manage permissions to
            rename drives, add members, hide, or delete.
          </p>
          <button type="button" className="upgrade" onClick={() => connectGoogleDriveForManage('/dashboard/artifacts')}>
            Reconnect with manage access
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="shared-drive-panel">
      <div className="shared-drive-panel-head">
        <strong>Manage shared drive</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="shared-drive-panel-body">
        {loading ? <div className="lib-loading">Loading…</div> : null}
        {error ? <div className="lib-error">{error}</div> : null}

        {!loading ? (
          <>
            <section className="shared-drive-section">
              <label className="shared-drive-label" htmlFor="sd-name">
                Name
              </label>
              <div className="shared-drive-row">
                <input
                  id="sd-name"
                  className="shared-drive-input"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  disabled={busy || !drive?.capabilities?.canRenameDrive}
                />
                <button
                  type="button"
                  className="lib-connect-action primary"
                  disabled={busy || !nameDraft.trim() || nameDraft.trim() === drive?.name}
                  onClick={() =>
                    void runAction('Rename', async () => {
                      const out = await updateSharedDrive(driveId, { name: nameDraft.trim() });
                      if (out.ok && out.drive) setDrive(out.drive);
                      await reload();
                      return out;
                    })
                  }
                >
                  Save
                </button>
              </div>
            </section>

            <section className="shared-drive-section">
              <h4>Members</h4>
              <ul className="shared-drive-members">
                {permissions.map((p) => (
                  <li key={p.id} className="shared-drive-member">
                    <div>
                      <strong>{p.displayName || p.emailAddress || p.id}</strong>
                      {p.emailAddress ? <span>{p.emailAddress}</span> : null}
                      <em>{p.role}</em>
                    </div>
                    {p.role !== 'owner' ? (
                      <button
                        type="button"
                        className="lib-connect-action danger"
                        disabled={busy}
                        onClick={() =>
                          void runAction('Remove member', async () => {
                            const out = await removeSharedDriveMember(driveId, p.id);
                            await reload();
                            return out;
                          })
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>

              <div className="shared-drive-add-member">
                <input
                  className="shared-drive-input"
                  type="email"
                  placeholder="user@company.com"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  disabled={busy}
                />
                <select
                  className="shared-drive-select"
                  value={memberRole}
                  onChange={(e) => setMemberRole(e.target.value)}
                  disabled={busy}
                >
                  {SHARED_DRIVE_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="lib-connect-action primary"
                  disabled={busy || !memberEmail.trim()}
                  onClick={() =>
                    void runAction('Add member', async () => {
                      const out = await addSharedDriveMember(driveId, memberEmail.trim(), memberRole);
                      if (out.ok) setMemberEmail('');
                      await reload();
                      return out;
                    })
                  }
                >
                  Add
                </button>
              </div>
            </section>

            <section className="shared-drive-section shared-drive-danger-zone">
              <h4>Drive visibility</h4>
              <p className="shared-drive-hint">
                {drive?.hidden
                  ? 'This shared drive is hidden from the default Drive view.'
                  : 'Hide removes this drive from the default Drive sidebar without deleting content.'}
              </p>
              <button
                type="button"
                className="lib-connect-action"
                disabled={busy}
                onClick={() =>
                  void runAction(drive?.hidden ? 'Unhide' : 'Hide', async () => {
                    const out = drive?.hidden ? await unhideSharedDrive(driveId) : await hideSharedDrive(driveId);
                    await reload();
                    return out;
                  })
                }
              >
                {drive?.hidden ? 'Unhide shared drive' : 'Hide shared drive'}
              </button>

              <h4>Delete shared drive</h4>
              <p className="shared-drive-hint">
                Permanently deletes the shared drive. All items must be in trash or removed first, and you need Manager
                (organizer) role.
              </p>
              <button
                type="button"
                className="lib-connect-action danger"
                disabled={busy || !drive?.capabilities?.canDeleteDrive}
                onClick={() => {
                  if (!window.confirm(`Delete shared drive "${drive?.name || driveName}" permanently?`)) return;
                  void runAction('Delete', async () => {
                    const out = await deleteSharedDrive(driveId);
                    if (out.ok) onDeleted();
                    return out;
                  });
                }}
              >
                Delete shared drive
              </button>
            </section>
          </>
        ) : null}
      </div>
    </aside>
  );
}
