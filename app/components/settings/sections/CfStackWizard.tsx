import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

type CfResource = { id: string; name: string; status?: string };
type CfAccount = { id: string; name: string };

type EnumerateResponse = {
  account_id?: string;
  accounts?: CfAccount[];
  needs_account_selection?: boolean;
  d1_databases?: CfResource[];
  workers?: CfResource[];
  tunnels?: CfResource[];
  error?: string;
};

type CfStackSelections = {
  d1Id: string;
  d1Name: string;
  workerName: string;
  tunnelId: string;
  tunnelName: string;
};

export type CfStackWizardProps = {
  open: boolean;
  /** Optional soft mirror target for deploy SSOT; stack itself is account-wide. */
  workspaceId?: string;
  onClose: () => void;
  onComplete: () => void;
};

const NONE = '';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((j as { error?: string }).error || res.statusText || 'Request failed');
  }
  return j as T;
}

export function CfStackWizard({ open, workspaceId, onClose, onComplete }: CfStackWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [enumerateErr, setEnumerateErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [d1Error, setD1Error] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<CfAccount[]>([]);
  const [needsAccountSelection, setNeedsAccountSelection] = useState(false);
  const [d1List, setD1List] = useState<CfResource[]>([]);
  const [workers, setWorkers] = useState<CfResource[]>([]);
  const [tunnels, setTunnels] = useState<CfResource[]>([]);
  const [selections, setSelections] = useState<CfStackSelections>({
    d1Id: NONE,
    d1Name: '',
    workerName: NONE,
    tunnelId: NONE,
    tunnelName: '',
  });
  const [savedOk, setSavedOk] = useState(false);

  const reset = useCallback(() => {
    setStep(1);
    setLoading(false);
    setEnumerateErr(null);
    setSaveErr(null);
    setD1Error(null);
    setAccountId(null);
    setAccounts([]);
    setNeedsAccountSelection(false);
    setD1List([]);
    setWorkers([]);
    setTunnels([]);
    setSelections({
      d1Id: NONE,
      d1Name: '',
      workerName: NONE,
      tunnelId: NONE,
      tunnelName: '',
    });
    setSavedOk(false);
  }, []);

  const enumerate = useCallback(async (explicitAccountId?: string) => {
    setLoading(true);
    setEnumerateErr(null);
    try {
      const data = await fetchJson<EnumerateResponse>(
        '/api/integrations/cloudflare_oauth/stack/enumerate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(explicitAccountId ? { account_id: explicitAccountId } : {}),
        },
      );
      setAccounts(data.accounts || []);
      if (data.needs_account_selection) {
        setNeedsAccountSelection(true);
        setAccountId(null);
        return;
      }
      setNeedsAccountSelection(false);
      setAccountId(data.account_id || null);
      setD1List(data.d1_databases || []);
      setWorkers(data.workers || []);
      setTunnels(data.tunnels || []);
    } catch (e) {
      setEnumerateErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    void enumerate();
    // reset/enumerate are stable across the component's lifetime; re-running this
    // effect should only be driven by the dialog opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleAccountPick = useCallback(
    (id: string) => {
      void enumerate(id);
    },
    [enumerate],
  );

  const handleSave = useCallback(async () => {
    setStep(2);
    setSaveErr(null);
    setD1Error(null);
    setLoading(true);
    setSavedOk(false);
    try {
      const ws = workspaceId?.trim();
      await fetchJson('/api/integrations/cloudflare_oauth/stack/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(ws ? { workspace_id: ws } : {}),
          ...(accountId && { account_id: accountId }),
          ...(selections.d1Id && {
            d1_database_id: selections.d1Id,
            d1_database_name: selections.d1Name || selections.d1Id,
          }),
          ...(selections.workerName && { worker_name: selections.workerName }),
          ...(selections.tunnelId && {
            tunnel_id: selections.tunnelId,
            tunnel_name: selections.tunnelName || selections.tunnelId,
          }),
        }),
      });
      setSavedOk(true);
      setStep(3);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      setSaveErr(msg);
      if (msg.includes('d1_not_found')) {
        setD1Error('D1 database not found — pick another or skip.');
        setStep(1);
      }
    } finally {
      setLoading(false);
    }
  }, [accountId, selections, workspaceId]);

  const handleFinish = useCallback(() => {
    onComplete();
    onClose();
  }, [onClose, onComplete]);

  if (!open) return null;

  const canProceedStep1 = !loading && !enumerateErr && !needsAccountSelection;
  const selectedAccount = accounts.find((a) => a.id === accountId) || null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cf-stack-wizard-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
          <div>
            <h3 id="cf-stack-wizard-title" className="text-[13px] font-bold text-[var(--text-heading)]">
              Configure Cloudflare stack
            </h3>
            <p className="text-[10px] text-muted mt-0.5">
              Link D1, Workers, and Tunnels to this workspace
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 flex flex-col gap-4 overflow-y-auto">
          {step === 1 ? (
            <>
              <div className="text-[12px] font-semibold text-[var(--text-heading)]">
                What are you building on?
              </div>

              {loading ? (
                <div className="flex items-center gap-2 text-[11px] text-muted py-6 justify-center">
                  <Loader2 size={16} className="animate-spin" />
                  Loading your Cloudflare resources…
                </div>
              ) : enumerateErr ? (
                <div className="text-[11px] text-[var(--accent-danger)]">{enumerateErr}</div>
              ) : needsAccountSelection ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-muted">
                    Your Cloudflare login has access to multiple accounts. Pick which one this
                    workspace builds on.
                  </p>
                  <label className="text-[10px] text-muted flex flex-col gap-1">
                    Cloudflare account
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleAccountPick(e.target.value);
                      }}
                      className="px-2 py-1.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[12px]"
                    >
                      <option value="" disabled>
                        Choose an account…
                      </option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.id.slice(0, 8)}…)
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {selectedAccount ? (
                    <div className="flex items-center justify-between text-[10px] text-muted">
                      <span>
                        Account: {selectedAccount.name}{' '}
                        <span className="font-mono">({selectedAccount.id.slice(0, 8)}…)</span>
                      </span>
                      {accounts.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setNeedsAccountSelection(true)}
                          className="text-[var(--solar-blue)] hover:underline"
                        >
                          Change
                        </button>
                      ) : null}
                    </div>
                  ) : accountId ? (
                    <p className="text-[10px] text-muted font-mono">Account {accountId}</p>
                  ) : null}

                  <label className="text-[10px] text-muted flex flex-col gap-1">
                    D1 database
                    <select
                      value={selections.d1Id}
                      onChange={(e) => {
                        const id = e.target.value;
                        const match = d1List.find((d) => d.id === id);
                        setSelections((s) => ({
                          ...s,
                          d1Id: id,
                          d1Name: match?.name || '',
                        }));
                        setD1Error(null);
                      }}
                      className="px-2 py-1.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[12px]"
                    >
                      <option value={NONE}>None / skip</option>
                      {d1List.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.id.slice(0, 8)}…)
                        </option>
                      ))}
                    </select>
                    {d1Error ? (
                      <span className="text-[var(--accent-danger)]">{d1Error}</span>
                    ) : null}
                  </label>

                  <label className="text-[10px] text-muted flex flex-col gap-1">
                    Worker
                    <select
                      value={selections.workerName}
                      onChange={(e) =>
                        setSelections((s) => ({ ...s, workerName: e.target.value }))
                      }
                      className="px-2 py-1.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[12px]"
                    >
                      <option value={NONE}>None / skip</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.name}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-[10px] text-muted flex flex-col gap-1">
                    Tunnel
                    <select
                      value={selections.tunnelId}
                      onChange={(e) => {
                        const id = e.target.value;
                        const match = tunnels.find((t) => t.id === id);
                        setSelections((s) => ({
                          ...s,
                          tunnelId: id,
                          tunnelName: match?.name || '',
                        }));
                      }}
                      className="px-2 py-1.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[12px]"
                    >
                      <option value={NONE}>None / skip</option>
                      {tunnels.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.status ? ` (${t.status})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="text-[12px] font-semibold text-[var(--text-heading)]">
                Verifying your stack…
              </div>
              <ul className="flex flex-col gap-2 text-[11px] text-main">
                <li className="flex items-center gap-2">
                  {loading ? (
                    <Loader2 size={14} className="animate-spin text-muted" />
                  ) : savedOk ? (
                    <Check size={14} className="text-[var(--accent-success)]" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-[var(--border-subtle)]" />
                  )}
                  Saving workspace bindings
                </li>
                {selections.d1Id ? (
                  <li className="flex items-center gap-2 pl-4 text-muted">
                    {loading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : savedOk ? (
                      <Check size={12} className="text-[var(--accent-success)]" />
                    ) : null}
                    D1: {selections.d1Name || selections.d1Id}
                  </li>
                ) : null}
                {selections.workerName ? (
                  <li className="flex items-center gap-2 pl-4 text-muted">
                    {savedOk ? <Check size={12} className="text-[var(--accent-success)]" /> : null}
                    Worker: {selections.workerName}
                  </li>
                ) : null}
                {selections.tunnelId ? (
                  <li className="flex items-center gap-2 pl-4 text-muted">
                    {savedOk ? <Check size={12} className="text-[var(--accent-success)]" /> : null}
                    Tunnel: {selections.tunnelName || selections.tunnelId}
                  </li>
                ) : null}
              </ul>
              {saveErr && step === 2 && !savedOk ? (
                <div className="text-[11px] text-[var(--accent-danger)]">{saveErr}</div>
              ) : null}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="text-[12px] font-semibold text-[var(--text-heading)]">
                You&apos;re connected
              </div>
              <p className="text-[11px] text-muted">
                Cloudflare stack settings were saved to this workspace.
              </p>
              <ul className="text-[11px] text-main space-y-1 rounded-lg border border-[var(--border-subtle)] p-3 bg-[var(--bg-panel)]">
                {selectedAccount ? (
                  <li>
                    <span className="text-muted">Account:</span> {selectedAccount.name}
                  </li>
                ) : null}
                {selections.d1Id ? (
                  <li>
                    <span className="text-muted">D1:</span> {selections.d1Name || selections.d1Id}
                  </li>
                ) : (
                  <li className="text-muted">D1: not selected</li>
                )}
                {selections.workerName ? (
                  <li>
                    <span className="text-muted">Worker:</span> {selections.workerName}
                  </li>
                ) : (
                  <li className="text-muted">Worker: not selected</li>
                )}
                {selections.tunnelId ? (
                  <li>
                    <span className="text-muted">Tunnel:</span>{' '}
                    {selections.tunnelName || selections.tunnelId}
                  </li>
                ) : (
                  <li className="text-muted">Tunnel: not selected</li>
                )}
              </ul>
            </>
          ) : null}
        </div>

        <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex justify-end gap-2">
          {step === 1 ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="text-[11px] px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canProceedStep1}
                onClick={() => void handleSave()}
                className="text-[11px] px-3 py-2 rounded-lg bg-[var(--solar-blue)] text-[var(--toggle-knob)] disabled:opacity-50"
              >
                Next →
              </button>
            </>
          ) : null}
          {step === 3 ? (
            <button
              type="button"
              onClick={handleFinish}
              className="text-[11px] px-3 py-2 rounded-lg bg-[var(--solar-blue)] text-[var(--toggle-knob)]"
            >
              Start building
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type CfStackConfig = {
  cf_account_id?: string;
  cf_d1_database_id?: string;
  cf_d1_database_name?: string;
  cf_worker_name?: string;
  cf_tunnel_id?: string;
  cf_tunnel_name?: string;
  cf_stack_configured_at?: number;
};

export function CfStackSummary({ config }: { config: CfStackConfig | null }) {
  if (!config) return null;
  const hasAny =
    Boolean(config.cf_stack_configured_at) ||
    Boolean(config.cf_d1_database_id || config.cf_d1_database_name) ||
    Boolean(config.cf_worker_name) ||
    Boolean(config.cf_tunnel_id || config.cf_tunnel_name) ||
    Boolean(config.cf_account_id);
  if (!hasAny) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {config.cf_account_id ? (
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-main">
          Account: …{String(config.cf_account_id).slice(-4)}
        </span>
      ) : null}
      {config.cf_d1_database_name || config.cf_d1_database_id ? (
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-main">
          D1: {config.cf_d1_database_name || config.cf_d1_database_id}
        </span>
      ) : null}
      {config.cf_worker_name ? (
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-main">
          Worker: {config.cf_worker_name}
        </span>
      ) : null}
      {config.cf_tunnel_name || config.cf_tunnel_id ? (
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-main">
          Tunnel: {config.cf_tunnel_name || config.cf_tunnel_id}
        </span>
      ) : null}
    </div>
  );
}
