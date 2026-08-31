import React, { useEffect, useState } from 'react';
import { AppBanner } from '@iam/cms-template-library';
import { isChatActivityBusy, subscribeChatActivityBusy } from './chatActivityGate';
import { dismissPwaUpdateForRemoteSha, wasPwaUpdateDismissed } from './ensureFreshDashboardBundle';
import {
  applyPwaUpdateAndReload,
  PWA_UPDATE_EVENT,
  type PwaUpdateDetail,
} from './pwaUpdateEvents';

/**
 * Surfaces deploy / service-worker / bundle-stale updates.
 * Product state remains local; the reusable library owns only the presentation.
 */
export function PwaUpdateBanner() {
  const [visible, setVisible] = useState(false);
  const [detail, setDetail] = useState<PwaUpdateDetail | null>(null);
  const [chatBusy, setChatBusy] = useState(() => isChatActivityBusy());
  const [reloadBusy, setReloadBusy] = useState(false);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const next = ((event as CustomEvent<PwaUpdateDetail>).detail ?? null) as PwaUpdateDetail | null;
      if (wasPwaUpdateDismissed(next?.remoteSha)) return;
      setDetail(next);
      setVisible(true);
    };
    window.addEventListener(PWA_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(PWA_UPDATE_EVENT, onUpdate);
  }, []);

  useEffect(() => subscribeChatActivityBusy(setChatBusy), []);

  if (!visible) return null;

  const title =
    detail?.reason === 'bundle_stale'
      ? 'Update ready'
      : detail?.reason === 'service_worker'
        ? 'App update available'
        : 'Update available';

  const handleReload = () => {
    if (chatBusy || reloadBusy) return;
    setReloadBusy(true);
    void applyPwaUpdateAndReload().finally(() => setReloadBusy(false));
  };

  return (
    <AppBanner
      placement="top-fixed"
      variant={chatBusy ? 'secondary' : 'default'}
      title={title}
      description={
        chatBusy
          ? 'Agent Sam is working. You can apply the update as soon as the current response finishes.'
          : 'A fresh dashboard bundle is ready. Reload when you are ready to apply it.'
      }
      primaryAction={{
        label: reloadBusy ? 'Updating…' : 'Update',
        onClick: handleReload,
        disabled: chatBusy || reloadBusy,
      }}
      onDismiss={() => {
        dismissPwaUpdateForRemoteSha(detail?.remoteSha);
        setVisible(false);
      }}
    />
  );
}
