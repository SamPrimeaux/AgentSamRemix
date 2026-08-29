import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { AppIcon } from '../ui/AppIcon';
import type { ConnectCatalogOption } from '../../client-api/connectTiles';
import './ConnectCatalogSheet.css';

export type ConnectCatalogSheetProps = {
  open: boolean;
  options: ConnectCatalogOption[];
  onClose: () => void;
  onConnected?: () => void;
};

async function connectApiKey(slug: string, apiKey: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/integrations/${encodeURIComponent(slug)}/connect`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean };
  if (!res.ok) return { ok: false, error: j.error || `Connect failed (${res.status})` };
  return { ok: true };
}

export function ConnectCatalogSheet({ open, options, onClose, onConnected }: ConnectCatalogSheetProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyModal, setKeyModal] = useState<ConnectCatalogOption | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState('');

  useEffect(() => {
    if (!open) {
      setError(null);
      setKeyModal(null);
      setApiKeyDraft('');
      setBusyKey(null);
    }
  }, [open]);

  const startOAuth = useCallback((row: ConnectCatalogOption) => {
    if (!row.connect_url) return;
    setBusyKey(row.connect_slug);
    window.location.href = row.connect_url;
  }, []);

  const submitApiKey = useCallback(async () => {
    if (!keyModal) return;
    const key = apiKeyDraft.trim();
    if (!key) {
      setError('API key required');
      return;
    }
    setBusyKey(keyModal.connect_slug);
    setError(null);
    try {
      const out = await connectApiKey(keyModal.connect_slug, key);
      if (!out.ok) {
        setError(out.error || 'Connect failed');
        return;
      }
      setKeyModal(null);
      setApiKeyDraft('');
      onConnected?.();
      onClose();
    } finally {
      setBusyKey(null);
    }
  }, [apiKeyDraft, keyModal, onClose, onConnected]);

  const onPick = useCallback(
    (row: ConnectCatalogOption) => {
      setError(null);
      if (row.auth_type === 'api_key') {
        setKeyModal(row);
        return;
      }
      if (!row.connect_url) {
        if (row.auth_type === 'oauth_or_key') {
          setKeyModal(row);
          return;
        }
        setError(`${row.title} is not wired for connect yet.`);
        return;
      }
      startOAuth(row);
    },
    [startOAuth],
  );

  if (!open) return null;

  return (
    <>
      <div className="iam-connect-sheet-backdrop" role="presentation" onClick={onClose} />
      <aside className="iam-connect-sheet" role="dialog" aria-labelledby="iam-connect-sheet-title">
        <header className="iam-connect-sheet-head">
          <div>
            <h2 id="iam-connect-sheet-title">Connect an app</h2>
            <p>Authorize once — your workspace picks up tools and context automatically.</p>
          </div>
          <button type="button" className="iam-section-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {error ? <p className="iam-connect-sheet-error" role="alert">{error}</p> : null}

        <div className="iam-connect-sheet-grid">
          {options.length === 0 ? (
            <p className="iam-connect-sheet-empty">All catalog apps are connected.</p>
          ) : (
            options.map((row) => (
              <AppIcon
                key={row.connect_slug}
                title={row.title}
                providerKey={row.provider_key}
                iconSlug={row.icon_slug}
                imageUrl={row.icon_url}
                registryIconUrl={row.custom_icon_url}
                size="md"
                subtitle={row.description?.slice(0, 48) || 'Connect'}
                disabled={busyKey === row.connect_slug}
                onPress={() => onPick(row)}
              />
            ))
          )}
        </div>
      </aside>

      {keyModal ? (
        <div className="iam-connect-key-modal-backdrop" role="presentation" onClick={() => setKeyModal(null)}>
          <div
            className="iam-connect-key-modal"
            role="dialog"
            aria-labelledby="iam-connect-key-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="iam-connect-key-title">Connect {keyModal.title}</h3>
            <p>Paste your {keyModal.api_key_label || 'API key'} — stored encrypted per workspace.</p>
            <input
              type="password"
              autoComplete="off"
              className="iam-connect-key-input"
              placeholder={keyModal.api_key_label || 'API key'}
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitApiKey();
              }}
            />
            <div className="iam-connect-key-actions">
              <button type="button" className="iam-connect-key-submit" disabled={!!busyKey} onClick={() => void submitApiKey()}>
                {busyKey ? 'Connecting…' : 'Connect'}
              </button>
              <button type="button" onClick={() => setKeyModal(null)} disabled={!!busyKey}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
