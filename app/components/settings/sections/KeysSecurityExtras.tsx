import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { formatVaultCreated, relativeTime } from '../settingsUi';

type IdentityRow = { provider: string; email: string; created_at: string };

type FindingRow = Record<string, unknown>;

type SessionRow = {
  id: string;
  provider?: string;
  ip_address?: string;
  user_agent?: string;
  last_active_at?: string | number | null;
};

function capitalizeProvider(p: string) {
  const s = String(p || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function suspiciousUa(ua: string) {
  const u = ua.toLowerCase();
  return u.includes('python-requests') || u.includes('curl/');
}

export function KeysSecurityExtras() {
  const [identities, setIdentities] = useState<IdentityRow[]>([]);
  const [identitiesLoaded, setIdentitiesLoaded] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(true);
  const [findingsBusy, setFindingsBusy] = useState<string | null>(null);
  const [findingActionMsg, setFindingActionMsg] = useState<string | null>(null);

  const loadFindings = useCallback(async () => {
    setFindingsLoading(true);
    try {
      const r = await fetch('/api/settings/security/findings', { credentials: 'same-origin' });
      const j = (await r.json().catch(() => ({}))) as { findings?: FindingRow[] };
      setFindings(Array.isArray(j.findings) ? j.findings : []);
    } catch {
      setFindings([]);
    } finally {
      setFindingsLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const r = await fetch('/api/settings/security/sessions', { credentials: 'same-origin' });
      const j = (await r.json().catch(() => ({}))) as { sessions?: SessionRow[]; error?: string };
      if (!r.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : `Sessions load failed (${r.status})`);
      }
      setSessions(Array.isArray(j.sessions) ? j.sessions : []);
    } catch (e) {
      setSessions([]);
      setSessionsError(e instanceof Error ? e.message : 'Failed to load sessions');
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const revokeSession = async (sessionId: string, snapshot: SessionRow[]) => {
    setSessions((prev) => prev.filter((x) => String(x.id) !== String(sessionId)));
    try {
      await fetch(`/api/settings/security/sessions/${encodeURIComponent(String(sessionId))}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } catch {
      setSessions(snapshot);
    }
  };

  const revokeOtherSessions = async () => {
    if (
      !window.confirm(
        'Revoke all sessions except the most recently active row shown? Confirm you are not locking yourself out.',
      )
    ) {
      return;
    }
    const toRevoke = sessions.slice(1);
    for (const s of toRevoke) {
      await fetch(`/api/settings/security/sessions/${encodeURIComponent(String(s.id))}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      }).catch(() => null);
    }
    await loadSessions();
  };

  useEffect(() => {
    fetch('/api/auth/identities', { credentials: 'include' })
      .then((r) => r.json())
      .then((j: { identities?: IdentityRow[] }) => {
        setIdentities(Array.isArray(j.identities) ? j.identities : []);
        setIdentitiesLoaded(true);
      })
      .catch(() => setIdentitiesLoaded(true));
    void loadFindings();
    void loadSessions();
  }, [loadFindings, loadSessions]);

  const openFindings = useMemo(
    () => findings.filter((f) => (f.status ?? 'open') === 'open'),
    [findings],
  );

  const patchFinding = async (id: string, status: string) => {
    setFindingsBusy(id);
    setFindingActionMsg(null);
    try {
      const r = await fetch(`/api/settings/security/findings/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        const err = typeof j.error === 'string' ? j.error : `HTTP ${r.status}`;
        setFindingActionMsg(`Could not update finding (${err}).`);
        return;
      }
      setFindings((prev) =>
        prev.map((row) => (String(row.id) === id ? { ...row, status } : row)),
      );
      try {
        window.dispatchEvent(new Event('iam-security-findings-changed'));
      } catch {
        /* ignore */
      }
      await loadFindings();
    } catch {
      setFindingActionMsg('Could not update finding.');
    } finally {
      setFindingsBusy(null);
    }
  };

  return (
    <>
      <section className="space-y-3 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-muted">
          Connected accounts
        </h3>
        {!identitiesLoaded ? (
          <p className="text-[11px] text-muted">Loading…</p>
        ) : identities.length === 0 ? (
          <p className="text-[11px] text-muted">No external accounts connected.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {identities.map((identity, idx) => (
              <div
                key={`${identity.provider}-${identity.email}-${idx}`}
                className="flex flex-wrap items-center gap-2 text-[11px] text-main"
              >
                <span className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-muted font-black uppercase tracking-widest">
                  {capitalizeProvider(identity.provider)}
                </span>
                <span className="text-muted">{identity.email}</span>
                <span className="text-[10px] text-muted">
                  Connected {identity.created_at ? formatVaultCreated(identity.created_at) : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        id="active-sessions"
        className="space-y-2 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] scroll-mt-24"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[var(--solar-cyan)]" />
            <h3 className="text-[11px] font-black uppercase tracking-widest text-muted">
              Active sessions
            </h3>
            <span className="text-[10px] text-muted">Last 24 hours</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={sessionsLoading}
              onClick={() => void loadSessions()}
              className="text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] text-muted hover:text-main disabled:opacity-40"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void revokeOtherSessions()}
              className="text-[10px] px-2 py-1 rounded border border-[var(--color-warning)]/40 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10"
            >
              Revoke all others
            </button>
          </div>
        </div>
        {sessionsError ? (
          <p className="text-[11px] text-[var(--color-danger)]">{sessionsError}</p>
        ) : null}
        {sessionsLoading ? (
          <p className="text-[11px] text-muted">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="text-[11px] text-muted">No active sessions.</p>
        ) : (
          <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-panel)]">
            <div className="grid grid-cols-6 gap-0 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
              <div className="col-span-1">Provider</div>
              <div className="col-span-1">IP</div>
              <div className="col-span-2">Agent</div>
              <div className="col-span-1">Active</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>
            {sessions.map((s) => {
              const ua = String(s.user_agent || '');
              const browser = ua.includes('Chrome')
                ? 'Chrome'
                : ua.includes('Firefox')
                  ? 'Firefox'
                  : ua.slice(0, 30);
              const flag = suspiciousUa(ua);
              return (
                <div
                  key={String(s.id)}
                  className="grid grid-cols-6 gap-0 px-4 py-3 border-b border-[var(--border-subtle)] items-center text-[11px]"
                >
                  <div className="col-span-1 flex flex-wrap items-center gap-1">
                    <span className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] text-muted font-black uppercase tracking-widest">
                      {String(s.provider || 'email')}
                    </span>
                    {flag ? (
                      <span className="inline-flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded bg-[var(--color-warning)]/15 text-[var(--color-warning)] border border-[var(--color-warning)]/40">
                        <ShieldAlert className="h-3 w-3" />
                        CLI
                      </span>
                    ) : null}
                  </div>
                  <div className="col-span-1 text-[10px] text-muted font-mono truncate">
                    {String(s.ip_address || '—')}
                  </div>
                  <div className="col-span-2 text-[10px] text-muted truncate">
                    {browser || '—'}
                  </div>
                  <div className="col-span-1 text-[10px] text-muted">
                    {s.last_active_at ? relativeTime(String(s.last_active_at)) : '—'}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const snapshot = sessions;
                        void revokeSession(String(s.id), snapshot);
                      }}
                      className="text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] text-muted hover:text-[var(--color-danger)] hover:border-[var(--color-danger)]/40"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section
        id="security-findings"
        className="space-y-2 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] scroll-mt-24"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
            <h3 className="text-[11px] font-black uppercase tracking-widest text-muted">
              Security findings
            </h3>
          </div>
          <button
            type="button"
            disabled={findingsLoading}
            onClick={() => void loadFindings()}
            className="text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] text-muted hover:text-main"
          >
            Refresh
          </button>
        </div>
        {findingActionMsg ? (
          <p className="text-[10px] text-[var(--color-warning)]">{findingActionMsg}</p>
        ) : null}
        {findingsLoading ? (
          <p className="text-[11px] text-muted">Loading findings…</p>
        ) : openFindings.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--color-success)]/30 bg-[var(--color-success)]/5 p-4 text-[11px] text-[var(--color-success)]">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            No open security findings
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {openFindings.map((f, i) => {
              const id = String(f.id ?? `idx_${i}`);
              const sev = String(f.severity ?? 'info').toUpperCase();
              const title = String(f.finding_type ?? f.title ?? 'finding');
              const snippet = String(f.snippet_redacted ?? f.description ?? '');
              const status = String(f.status ?? 'open');
              const created = f.created_at;
              return (
                <div
                  key={id}
                  className="rounded-lg border border-[var(--border-subtle)] p-3 space-y-2 bg-[var(--bg-app)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-widest border ${
                        sev === 'CRITICAL'
                          ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)] border-[var(--color-danger)]/40'
                          : sev === 'HIGH'
                            ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning)] border-[var(--color-warning)]/40'
                            : 'bg-[var(--bg-hover)] text-muted border-[var(--border-subtle)]'
                      }`}
                    >
                      {sev}
                    </span>
                    <span className="text-[12px] text-main">{title}</span>
                    <span className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-hover)] text-muted">
                      {status}
                    </span>
                  </div>
                  <pre className="font-mono text-[10px] text-muted whitespace-pre-wrap break-all">
                    {snippet || '—'}
                  </pre>
                  <div className="text-[10px] text-muted">
                    {created != null ? <>Recorded {relativeTime(String(created))}</> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={findingsBusy === id}
                      onClick={() => void patchFinding(id, 'triaged')}
                      className="text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] text-main"
                    >
                      Acknowledge
                    </button>
                    <button
                      type="button"
                      disabled={findingsBusy === id}
                      onClick={() => void patchFinding(id, 'false_positive')}
                      className="text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] text-muted"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
