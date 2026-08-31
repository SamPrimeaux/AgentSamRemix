import React, { useEffect, useState } from 'react';
import { AppBanner } from '@iam/cms-template-library';
import {
  dismissInstallCoach,
  isInstallCoachDismissed,
  isIosSafariBrowserTab,
} from './pwaPlatform';

/** iOS Safari install nudge — iOS has no beforeinstallprompt event. */
export function InstallCoach() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(isIosSafariBrowserTab() && !isInstallCoachDismissed());
  }, []);

  if (!visible) return null;

  return (
    <AppBanner
      placement="bottom-fixed"
      variant="secondary"
      title="Install Agent Sam on your iPhone"
      description={
        <span>
          In Safari, tap <strong>Share</strong> → <strong>Add to Home Screen</strong> for the full-screen PWA.
        </span>
      }
      onDismiss={() => {
        dismissInstallCoach();
        setVisible(false);
      }}
    />
  );
}
