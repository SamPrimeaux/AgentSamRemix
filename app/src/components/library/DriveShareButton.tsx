import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { openDriveShareDialog } from '../../lib/library/googleDriveWidgets';

type Props = {
  fileId: string;
  disabled?: boolean;
  onError?: (message: string) => void;
};

export function DriveShareButton({ fileId, disabled, onError }: Props) {
  const [busy, setBusy] = useState(false);

  const handleShare = async () => {
    if (disabled || busy || !fileId) return;
    setBusy(true);
    try {
      await openDriveShareDialog(fileId);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not open share dialog');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="lib-drive-action"
      disabled={disabled || busy || !fileId}
      onClick={() => void handleShare()}
    >
      <Share2 size={16} strokeWidth={1.75} aria-hidden />
      {busy ? 'Opening…' : 'Share'}
    </button>
  );
}

export default DriveShareButton;
