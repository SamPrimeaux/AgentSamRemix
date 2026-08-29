import type { LibraryItem } from '../../.././types';
import { defaultExportFormat, driveExportUrl, googleAppsLabel, isGoogleAppsMime } from '../../lib/library/driveMimeTypes';
import { DriveShareButton } from './DriveShareButton';
import { SaveToDriveButton } from './SaveToDriveButton';
import { resolveLibrarySaveToDriveSrc } from '../../lib/library/googleDriveWidgets';

type Props = {
  item: LibraryItem;
  driveConnected: boolean;
  onToast: (msg: string) => void;
};

export function LibraryFileDriveActions({ item, driveConnected, onToast }: Props) {
  if (item.kind !== 'file') return null;

  const saveSrc = resolveLibrarySaveToDriveSrc(item);
  const isDriveFile = item.source === 'drive';
  const driveFileId = isDriveFile ? item.nativeId : null;
  const googleApps = isDriveFile && isGoogleAppsMime(item.mimeType);
  const exportFormat = googleApps ? defaultExportFormat(item.mimeType) : null;
  const exportHref =
    googleApps && driveFileId && exportFormat
      ? driveExportUrl(driveFileId, exportFormat)
      : null;
  const workspaceLabel = googleApps ? googleAppsLabel(item.mimeType) : null;

  return (
    <div className="lib-drive-actions">
      {workspaceLabel ? (
        <span className="lib-drive-workspace-tag">{workspaceLabel}</span>
      ) : null}
      {exportHref ? (
        <a className="lib-drive-action" href={exportHref} download target="_blank" rel="noopener noreferrer">
          Download {exportFormat?.toUpperCase()}
        </a>
      ) : null}
      {saveSrc ? (
        <SaveToDriveButton src={saveSrc} filename={item.name} />
      ) : (
        <button type="button" className="lib-drive-action lib-drive-action--muted" disabled title="No downloadable URL for this file">
          Save to Drive
        </button>
      )}
      {isDriveFile && driveFileId ? (
        <DriveShareButton
          fileId={driveFileId}
          disabled={!driveConnected}
          onError={(msg) => onToast(msg)}
        />
      ) : null}
    </div>
  );
}
