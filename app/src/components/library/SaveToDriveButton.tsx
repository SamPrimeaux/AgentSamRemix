import { useEffect, useRef, useState } from 'react';
import {
  loadGooglePlatformScript,
  saveToDriveSiteName,
} from '../../lib/library/googleDriveWidgets';

type Props = {
  src: string;
  filename: string;
  sitename?: string;
  className?: string;
};

/** Google-hosted Save to Drive widget (browser session → user's My Drive). */
export function SaveToDriveButton({ src, filename, sitename, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    void (async () => {
      try {
        await loadGooglePlatformScript();
        if (cancelled || !hostRef.current || !window.gapi?.savetodrive) return;
        hostRef.current.innerHTML = '';
        window.gapi.savetodrive.render(hostRef.current, {
          src,
          filename,
          sitename: sitename || saveToDriveSiteName(),
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, filename, sitename]);

  if (failed) {
    return (
      <button type="button" className="lib-drive-action lib-drive-action--muted" disabled title="Save to Drive unavailable">
        Save to Drive
      </button>
    );
  }

  return (
    <div
      ref={hostRef}
      className={`lib-save-to-drive-host${className ? ` ${className}` : ''}`}
      aria-label={`Save ${filename} to Google Drive`}
    />
  );
}

export default SaveToDriveButton;
