import React, { useCallback, useEffect, useState } from 'react';

export type McpTokenRow = {
  id: string;
  label: string | null;
  rate_limit_per_hour: number | null;
  expires_at: number | null;
  created_at: number | null;
  allowed_tools: string | null;
};

/**
 * Workspace MCP bearer tokens — shown once in modal; never persisted in React state after close.
 */
export function McpTokensPanel() {
  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [rateLimit, setRateLimit] = useState('1000');
  const [expiryDays, setExpiryDays] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalBearer, setModalBearer] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/settings/mcp-tokens', { credentials: 'same-origin' });
      const j = (await r.json().catch(() => ({}))) as { tokens?: McpTokenRow[]; error?: string };
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      setTokens(Array.isArray(j.tokens) ? j.tokens : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tokens');
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setModalBearer(null);
  }, []);

  const generateToken = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const rate = Math.max(1, Math.min(10000, Number.parseInt(rateLimit, 10) || 1000));
      const body: Record<string, unknown> = {
        label: label.trim() || 'Dashboard MCP token',
        rateLimitPerHour: rate,
      };
      if (expiryDays.trim()) {
        body.expiresInDays = Math.max(1, Number.parseInt(expiryDays, 10) || 0);
      }
      const r = await fetch('/api/settings/mcp-tokens', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as { bearer?: string; error?: string };
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Create failed (${r.status})`);
      if (!j.bearer) throw new Error('No bearer returned');
      setModalBearer(j.bearer);
      setModalOpen(true);
      setLabel('');
      await loadTokens();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }, [expiryDays, label, loadTokens, rateLimit]);

  const revokeToken = useCallback(
    async (tokenId: string) => {
      if (!window.confirm('Revoke this MCP token? Clients using it will stop working.')) return;
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(`/api/settings/mcp-tokens/${encodeURIComponent(tokenId)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Revoke failed (${r.status})`);
        await loadTokens();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Revoke failed');
      } finally {
        setBusy(false);
      }
    },
    [loadTokens],
  );

  const copyBearer = useCallback(async () => {
    if (!modalBearer) return;
    try {
      await navigator.clipboard.writeText(modalBearer);
    } catch {
      /* ignore */
    }
  }, [modalBearer]);

  return (
    <section className="flex flex-col gap-3 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      <div className="text-[10px] font-black uppercase tracking-widest text-muted">
        Workspace MCP tokens
      </div>
      <p className="text-[11px] text-muted">
        Bearer is shown once after generate. It is not stored in the dashboard after you close the dialog.
      </p>
      {error ? <p className="text-[11px] text-[var(--color-danger)]">{error}</p> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted">Label</span>
          <input
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[12px]"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Dev MCP token"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted">Rate limit / hour</span>
          <input
            type="number"
            min={1}
            max={10000}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[12px]"
            value={rateLimit}
            onChange={(e) => setRateLimit(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted">Expires (days, optional)</span>
          <input
            type="number"
            min={1}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[12px]"
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
            placeholder="90"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void generateToken()}
        className="self-start px-4 py-2 rounded-lg text-[11px] font-semibold bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30 disabled:opacity-50"
      >
        {busy ? 'Working…' : 'Generate token'}
      </button>
      {loading ? (
        <p className="text-[11px] text-muted">Loading tokens…</p>
      ) : tokens.length === 0 ? (
        <p className="text-[11px] text-muted">No active tokens for this workspace.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[11px]"
            >
              <div className="min-w-0">
                <div className="font-semibold text-main truncate">{t.label || t.id}</div>
                <div className="text-muted font-mono">
                  {t.id} · {t.rate_limit_per_hour ?? '—'}/hr
                  {t.expires_at ? ` · exp ${t.expires_at}` : ''}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void revokeToken(t.id)}
                className="shrink-0 text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] text-[var(--color-danger)] hover:border-[var(--color-danger)]/40"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {modalOpen && modalBearer ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mcp-token-modal-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-xl">
            <h3 id="mcp-token-modal-title" className="text-[13px] font-bold text-[var(--text-heading)] mb-2">
              Copy your MCP bearer
            </h3>
            <p className="text-[11px] text-muted mb-3">
              This value is shown once. Closing clears it from this browser session.
            </p>
            <code className="block text-[11px] font-mono text-[var(--solar-cyan)] break-all mb-4 p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)]">
              {modalBearer}
            </code>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => void copyBearer()}
                className="px-3 py-2 text-[11px] rounded-lg border border-[var(--border-subtle)]"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="px-3 py-2 text-[11px] rounded-lg bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
