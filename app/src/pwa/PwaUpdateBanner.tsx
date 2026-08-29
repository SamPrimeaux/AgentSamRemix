import React, { useEffect, useState } from 'react';
import { isChatActivityBusy, subscribeChatActivityBusy } from './chatActivityGate';
import { dismissPwaUpdateForRemoteSha, wasPwaUpdateDismissed } from './ensureFreshDashboardBundle';
import {
  applyPwaUpdateAndReload,
  PWA_UPDATE_EVENT,
  type PwaUpdateDetail,
} from './pwaUpdateEvents';

/**
 * Surfaces deploy / service-worker / bundle-stale updates.
 * Slim single-line chrome — reload is user-initiated only (disabled while chat streams).
 */
export function PwaUpdateBanner() {
  const [visible, setVisible] = useState(false);
  const [detail, setDetail] = useState<PwaUpdateDetail | null>(null);
  const [chatBusy, setChatBusy] = useState(() => isChatActivityBusy());
  const [reloadBusy, setReloadBusy] = useState(false);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const next = ((e as CustomEvent<PwaUpdateDetail>).detail ?? null) as PwaUpdateDetail | null;
      if (wasPwaUpdateDismissed(next?.remoteSha)) return;
      setDetail(next);
      setVisible(true);
    };
    window.addEventListener(PWA_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(PWA_UPDATE_EVENT, onUpdate);
  }, []);

  useEffect(() => subscribeChatActivityBusy(setChatBusy), []);

  if (!visible) return null;

  const reasonLabel =
    detail?.reason === 'bundle_stale'
      ? 'Update ready'
      : detail?.reason === 'service_worker'
        ? 'App update'
        : 'Update';

  const handleReload = () => {
    if (chatBusy || reloadBusy) return;
    setReloadBusy(true);
    void applyPwaUpdateAndReload().finally(() => setReloadBusy(false));
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 19999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        flexWrap: 'nowrap',
        padding: '6px 10px',
        paddingTop: 'max(6px, env(safe-area-inset-top, 0px))',
        fontSize: 12,
        fontWeight: 600,
        background: 'rgba(45, 212, 191, 0.92)',
        color: '#00212b',
        borderBottom: '1px solid rgba(0, 0, 0, 0.12)',
        minHeight: 36,
      }}
    >
      <span style={{ marginRight: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {reasonLabel}
        {chatBusy ? ' — finish chat' : ''}
      </span>
      <button
        type="button"
        disabled={chatBusy || reloadBusy}
        onClick={handleReload}
        title={chatBusy ? 'Wait until Agent Sam finishes responding' : 'Reload to apply update'}
        style={{
          border: '1px solid rgba(0, 33, 43, 0.35)',
          background: chatBusy ? 'rgba(0,33,43,0.35)' : '#00212b',
          color: chatBusy ? 'rgba(45,212,191,0.55)' : '#2dd4bf',
          borderRadius: 6,
          padding: '4px 10px',
          font: 'inherit',
          fontSize: 11,
          fontWeight: 700,
          cursor: chatBusy || reloadBusy ? 'not-allowed' : 'pointer',
          flexShrink: 0,
        }}
      >
        {reloadBusy ? '…' : 'Reload'}
      </button>
      <button
        type="button"
        aria-label="Dismiss update notice"
        onClick={() => {
          dismissPwaUpdateForRemoteSha(detail?.remoteSha);
          setVisible(false);
        }}
        style={{
          border: 'none',
          background: 'transparent',
          color: '#00212b',
          font: 'inherit',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          opacity: 0.7,
          padding: '4px 6px',
          flexShrink: 0,
        }}
      >
        Later
      </button>
    </div>
  );
}
