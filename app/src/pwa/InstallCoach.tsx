import React, { useEffect, useState } from 'react';
import {
  dismissInstallCoach,
  isInstallCoachDismissed,
  isIosSafariBrowserTab,
} from './pwaPlatform';

/**
 * iOS Safari install nudge — there is no beforeinstallprompt on iOS.
 */
export function InstallCoach() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(isIosSafariBrowserTab() && !isInstallCoachDismissed());
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        zIndex: 19990,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid rgba(45, 212, 191, 0.45)',
        background: 'rgba(10, 45, 56, 0.96)',
        color: '#b0ccd2',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <div style={{ flex: 1 }}>
        <strong style={{ display: 'block', color: '#2dd4bf', marginBottom: 4 }}>
          Install IAM on your iPhone
        </strong>
        Tap <strong style={{ color: '#e2e8f0' }}>Share</strong>
        {' → '}
        <strong style={{ color: '#e2e8f0' }}>Add to Home Screen</strong>
        {' '}for the full-screen app.
      </div>
      <button
        type="button"
        aria-label="Dismiss install instructions"
        onClick={() => {
          dismissInstallCoach();
          setVisible(false);
        }}
        style={{
          flexShrink: 0,
          border: '1px solid rgba(176, 204, 210, 0.35)',
          background: 'transparent',
          color: '#9cb5bc',
          borderRadius: 8,
          padding: '6px 10px',
          font: 'inherit',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
