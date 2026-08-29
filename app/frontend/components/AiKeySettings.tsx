import React, { useState, useEffect, useCallback } from 'react';

interface AiKeyStatus {
  configured: boolean;
  source: 'user' | 'default' | 'none';
  last4?: string;
  updatedAt?: number;
}

/**
 * Gemini API key management. Setting a key here calls
 * PUT /api/settings/ai-keys/gemini, which writes an AES-GCM encrypted row
 * into D1 (user_secrets) -- effective on the very next /api/gemini/generate
 * call, no redeploy or wrangler secret put needed. The raw key is never
 * returned by the API after it's set, only last4 for confirmation.
 */
export const AiKeySettings: React.FC = () => {
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai-keys/gemini');
      if (res.status === 401) {
        setError('Sign in required to manage API keys.');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AiKeyStatus = await res.json();
      setStatus(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load key status');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = async () => {
    const value = inputValue.trim();
    if (!value) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/ai-keys/gemini', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }
      const data: AiKeyStatus = await res.json();
      setStatus(data);
      setInputValue('');
    } catch (e: any) {
      setError(e?.message || 'Failed to save key');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/ai-keys/gemini', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AiKeyStatus = await res.json();
      setStatus(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to clear key');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-sub-card" style={{ marginTop: '16px' }}>
      <div className="sub-card-header">
        <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--app-accent)' }}>
          key
        </span>
        <span className="sub-card-title">Gemini API Key</span>
      </div>
      <p className="sub-card-desc">
        Stored encrypted server-side, never sent to the browser. Switching keys here takes
        effect on your next generation immediately -- no redeploy needed.
      </p>

      {status && (
        <div style={{ fontSize: '13px', color: 'var(--app-text-secondary)', marginBottom: '10px' }}>
          {status.source === 'user' && <>Using your own key (ends in …{status.last4})</>}
          {status.source === 'default' && <>Using the platform default key</>}
          {status.source === 'none' && <>No key configured — generation will not work yet</>}
        </div>
      )}

      {error && (
        <div style={{ fontSize: '13px', color: '#f87171', marginBottom: '10px' }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="password"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Paste a Gemini API key"
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid var(--app-border)',
            background: 'var(--app-surface-2)',
            color: 'var(--app-text-primary)',
            fontSize: '13px',
          }}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !inputValue.trim()}
          className="settings-nav-tab"
          style={{ padding: '8px 14px' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {status?.source === 'user' && (
          <button
            type="button"
            onClick={handleClear}
            disabled={saving}
            className="settings-nav-tab"
            style={{ padding: '8px 14px' }}
          >
            Use default
          </button>
        )}
      </div>
    </div>
  );
};
