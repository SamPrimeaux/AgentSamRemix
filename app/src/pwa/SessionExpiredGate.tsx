import React, { useEffect, useState } from 'react';
import { isPhoneViewport } from '../../lib/breakpoints';
import {
  buildLoginRecoveryUrl,
  clearSessionExpiredFlag,
  isSessionExpiredFlag,
  subscribeSessionExpired,
} from './authSessionState';
import { applyPwaUpdateAndReload } from './pwaUpdateEvents';

type SessionExpiredGateProps = {
  /** Render even when viewport is wider (boot-time auth failure). */
  forced?: boolean;
};

/**
 * Mobile-first full-screen gate when session cookie is gone after deploy / PWA reload.
 * Never expects users to delete the home-screen app — always offers Sign in + Reload.
 */
export function SessionExpiredGate({ forced = false }: SessionExpiredGateProps) {
  const [visible, setVisible] = useState(() => forced || isSessionExpiredFlag());
  const [reloadBusy, setReloadBusy] = useState(false);

  useEffect(() => {
    if (forced) {
      setVisible(true);
      return;
    }
    return subscribeSessionExpired(() => setVisible(true));
  }, [forced]);

  useEffect(() => {
    if (!visible || forced) return;
    if (!isPhoneViewport() && !forced) {
      setVisible(false);
    }
  }, [visible, forced]);

  if (!visible) return null;

  const loginHref = buildLoginRecoveryUrl();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="iam-session-expired-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(0, 8, 12, 0.88)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        style={{
          width: 'min(400px, 100%)',
          padding: '28px 22px',
          borderRadius: 16,
          border: '1px solid var(--dashboard-border, rgba(255,255,255,0.12))',
          background: 'var(--bg-elevated, #0f1720)',
          color: 'var(--color-main, #e2e8f0)',
          textAlign: 'center',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        <h1
          id="iam-session-expired-title"
          style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}
        >
          Session expired
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.55, color: 'var(--color-muted, #94a3b8)' }}>
          Your sign-in ended or this device loaded a fresh app shell after an update. Sign in again — no need to
          remove the app from your home screen.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a
            href={loginHref}
            onClick={() => clearSessionExpiredFlag()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '12px 16px',
              borderRadius: 10,
              background: 'var(--color-main, #e2e8f0)',
              color: 'var(--dashboard-canvas, #0d1117)',
              fontWeight: 700,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            Sign in
          </a>
          <button
            type="button"
            disabled={reloadBusy}
            onClick={() => {
              setReloadBusy(true);
              void applyPwaUpdateAndReload().finally(() => setReloadBusy(false));
            }}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid var(--dashboard-border, rgba(255,255,255,0.14))',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              cursor: reloadBusy ? 'wait' : 'pointer',
              opacity: reloadBusy ? 0.6 : 1,
            }}
          >
            {reloadBusy ? 'Reloading…' : 'Reload app'}
          </button>
        </div>
      </div>
    </div>
  );
}
