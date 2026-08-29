import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Eye,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';

type SecretItem = {
  id: string;
  category: 'provider' | 'personal';
  provider?: string | null;
  label?: string | null;
  secret_name?: string | null;
  status?: string;
  last_four?: string;
  validated_at?: string | null;
  validation_status?: string | null;
  updated_at?: string | number | null;
  cloudflare_account_mask?: string | null;
};

type ProviderOption = { id: string; label: string };
type AuditItem = { id: string; api_key_id?: string; event_type?: string; actor?: string; notes?: string; created_at?: string | number };
type Validation = { ok?: boolean; provider?: string; checks?: Array<{ id: string; status: string; detail?: string; latency_ms?: number }>; warnings?: string[]; error?: string; message?: string };

type DrawerMode = 'add' | 'rotate' | 'reveal' | null;

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `HTTP ${response.status}`) as Error & { status?: number; data?: any };
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data as T;
};

function relativeTime(value?: string | number | null) {
  if (value == null || value === '') return '—';
  const raw = typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value;
  const at = new Date(raw).getTime();
  if (!Number.isFinite(at)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export const KeysSettings: React.FC = () => {
  const [providerKeys, setProviderKeys] = useState<SecretItem[]>([]);
  const [personalSecrets, setPersonalSecrets] = useState<SecretItem[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [vaultConfigured, setVaultConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drawer, setDrawer] = useState<DrawerMode>(null);
  const [target, setTarget] = useState<SecretItem | null>(null);
  const [category, setCategory] = useState<'provider' | 'personal'>('provider');
  const [provider, setProvider] = useState('openai');
  const [label, setLabel] = useState('');
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [validateOnSave, setValidateOnSave] = useState(true);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState('');
  const [revealSeconds, setRevealSeconds] = useState(0);
  const revealTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [providerData, personalData, auditData, providerDataOptions, hints] = await Promise.all([
        api<{ items: SecretItem[] }>('/api/settings/keys?category=provider'),
        api<{ items: SecretItem[] }>('/api/settings/keys?category=personal'),
        api<{ items: AuditItem[] }>('/api/settings/keys/audit?limit=20'),
        api<{ providers: ProviderOption[] }>('/api/settings/keys/providers'),
        api<{ vault_configured?: boolean }>('/api/settings/keys/hints'),
      ]);
      setProviderKeys(providerData.items || []);
      setPersonalSecrets(personalData.items || []);
      setAudit(auditData.items || []);
      setProviders(providerDataOptions.providers || []);
      setVaultConfigured(Boolean(hints.vault_configured));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (revealTimer.current) window.clearInterval(revealTimer.current); }, []);

  const active = useMemo(() => [...providerKeys, ...personalSecrets].filter((item) => item.status !== 'revoked').length, [providerKeys, personalSecrets]);
  const providerCount = useMemo(() => new Set(providerKeys.map((item) => item.provider).filter(Boolean)).size, [providerKeys]);

  const resetDrawer = () => {
    if (revealTimer.current) window.clearInterval(revealTimer.current);
    revealTimer.current = null;
    setDrawer(null);
    setTarget(null);
    setSecretValue('');
    setRevealed('');
    setRevealSeconds(0);
    setValidation(null);
    setSaving(false);
  };

  const openAdd = (nextCategory: 'provider' | 'personal' = 'provider') => {
    setCategory(nextCategory);
    setProvider(nextCategory === 'provider' ? 'openai' : 'other');
    setLabel('');
    setSecretName('');
    setSecretValue('');
    setCloudflareAccountId('');
    setValidation(null);
    setDrawer('add');
  };

  const saveNew = async () => {
    setSaving(true);
    setError('');
    try {
      const body: any = {
        category,
        provider: category === 'provider' ? provider : 'other',
        label,
        secret_name: category === 'personal' ? secretName : undefined,
        api_key: secretValue,
        validate: category === 'provider' ? validateOnSave : false,
      };
      if (provider === 'cloudflare') body.cloudflare_account_id = cloudflareAccountId;
      await api('/api/settings/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      setNotice(category === 'provider' ? 'Provider key saved.' : 'Personal secret saved.');
      resetDrawer();
      await load();
    } catch (e: any) {
      if (e?.data?.checks) setValidation(e.data as Validation);
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  const validateExisting = async (item: SecretItem) => {
    setError('');
    setNotice('');
    try {
      const result = await api<Validation>(`/api/settings/keys/${encodeURIComponent(item.id)}/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setValidation(result);
      setTarget(item);
      setNotice(result.ok ? `${item.label || item.provider} validated.` : 'Validation failed.');
      await load();
    } catch (e: any) {
      setValidation(e?.data || null);
      setError(e instanceof Error ? e.message : 'Validation failed');
    }
  };

  const beginRotate = (item: SecretItem) => {
    setTarget(item);
    setSecretValue('');
    setValidation(null);
    setDrawer('rotate');
  };

  const rotate = async () => {
    if (!target) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/settings/keys/${encodeURIComponent(target.id)}/rotate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: secretValue }) });
      setNotice('Credential rotated.');
      resetDrawer();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rotate failed');
      setSaving(false);
    }
  };

  const reveal = async (item: SecretItem) => {
    setError('');
    try {
      const result = await api<{ value: string; expires_in_sec?: number }>(`/api/settings/keys/${encodeURIComponent(item.id)}/reveal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setTarget(item);
      setRevealed(result.value || '');
      setRevealSeconds(result.expires_in_sec || 30);
      setDrawer('reveal');
      if (revealTimer.current) window.clearInterval(revealTimer.current);
      revealTimer.current = window.setInterval(() => {
        setRevealSeconds((seconds) => {
          if (seconds <= 1) {
            if (revealTimer.current) window.clearInterval(revealTimer.current);
            revealTimer.current = null;
            setRevealed('');
            return 0;
          }
          return seconds - 1;
        });
      }, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reveal failed');
    }
  };

  const revoke = async (item: SecretItem) => {
    if (!window.confirm(`Revoke ${item.label || item.secret_name || item.provider || 'this secret'}? This cannot reveal it again.`)) return;
    setError('');
    try {
      await api(`/api/settings/keys/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      setNotice('Credential revoked.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    }
  };

  const copyReveal = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setNotice('Copied to clipboard. Clear your clipboard when finished.');
  };

  return (
    <section className="as-settings-section">
      <div className="as-settings-header">
        <div>
          <span className="as-settings-kicker">KEYS &amp; SECRETS</span>
          <h1>Provider credentials</h1>
          <p>BYOK credentials are encrypted at rest and scoped to your account. Raw values are only returned through the audited Reveal action.</p>
        </div>
        <div className="as-settings-actions">
          <button type="button" className="secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15} />Refresh</button>
          <button type="button" className="primary" onClick={() => openAdd('provider')}><Plus size={15} />Add key</button>
        </div>
      </div>

      {vaultConfigured === false && (
        <div className="as-settings-banner danger"><AlertTriangle size={16} /><span>Vault encryption is not configured. Writes and reveals are disabled until VAULT_MASTER_KEY is set.</span></div>
      )}
      {error && <div className="as-settings-banner danger"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => setError('')}><X size={14} /></button></div>}
      {notice && <div className="as-settings-banner success"><CheckCircle2 size={16} /><span>{notice}</span><button onClick={() => setNotice('')}><X size={14} /></button></div>}

      <div className="as-settings-summary">
        <div><small>TOTAL</small><strong>{providerKeys.length + personalSecrets.length}</strong></div>
        <div><small>ACTIVE</small><strong>{active}</strong></div>
        <div><small>PROVIDERS</small><strong>{providerCount}</strong></div>
        <div><small>VAULT</small><strong>{vaultConfigured == null ? '—' : vaultConfigured ? 'Ready' : 'Missing'}</strong></div>
      </div>

      <div className="as-settings-card">
        <div className="as-settings-card-head">
          <div><KeyRound size={17} /><div><strong>Provider keys</strong><small>Runtime-swappable credentials used by model and service adapters.</small></div></div>
          <button type="button" className="text" onClick={() => openAdd('provider')}><Plus size={14} />Add</button>
        </div>
        {loading ? <div className="as-settings-empty">Loading provider keys…</div> : providerKeys.length === 0 ? (
          <div className="as-settings-empty"><ShieldCheck size={20} /><span>No provider keys saved yet.</span></div>
        ) : (
          <div className="as-settings-table-wrap">
            <table className="as-settings-table">
              <thead><tr><th>Provider</th><th>Label</th><th>Key</th><th>Validation</th><th>Updated</th><th /></tr></thead>
              <tbody>{providerKeys.map((item) => (
                <tr key={item.id}>
                  <td><span className="as-provider-chip">{item.provider || 'other'}</span></td>
                  <td>{item.label || '—'}{item.cloudflare_account_mask && <small className="subline">Account {item.cloudflare_account_mask}</small>}</td>
                  <td><code>•••• {item.last_four || '????'}</code></td>
                  <td>{item.validation_status === 'pass' || item.validated_at ? <span className="as-status good"><CheckCircle2 size={13} />Validated</span> : <span className="as-status">Not checked</span>}</td>
                  <td>{relativeTime(item.updated_at)}</td>
                  <td><div className="as-row-actions">
                    <button title="Validate" onClick={() => void validateExisting(item)}><ShieldCheck size={14} /></button>
                    <button title="Reveal" onClick={() => void reveal(item)}><Eye size={14} /></button>
                    <button title="Rotate" onClick={() => beginRotate(item)}><RotateCcw size={14} /></button>
                    <button title="Revoke" className="danger" onClick={() => void revoke(item)}><Trash2 size={14} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="as-settings-card">
        <div className="as-settings-card-head">
          <div><ShieldCheck size={17} /><div><strong>Personal secrets</strong><small>Arbitrary tokens/passwords stored in the same audited vault without provider routing.</small></div></div>
          <button type="button" className="text" onClick={() => openAdd('personal')}><Plus size={14} />Add secret</button>
        </div>
        {personalSecrets.length === 0 ? <div className="as-settings-empty">No personal secrets yet.</div> : (
          <div className="as-settings-secret-list">{personalSecrets.map((item) => (
            <div key={item.id}>
              <div><strong>{item.label || item.secret_name}</strong><small>{item.secret_name}</small></div>
              <code>•••• {item.last_four || '????'}</code>
              <div className="as-row-actions"><button title="Reveal" onClick={() => void reveal(item)}><Eye size={14} /></button><button title="Rotate" onClick={() => beginRotate(item)}><RotateCcw size={14} /></button><button title="Revoke" className="danger" onClick={() => void revoke(item)}><Trash2 size={14} /></button></div>
            </div>
          ))}</div>
        )}
      </div>

      <div className="as-settings-card">
        <div className="as-settings-card-head"><div><ShieldCheck size={17} /><div><strong>Audit</strong><small>Create, rotate, reveal, validate and revoke events.</small></div></div></div>
        {audit.length === 0 ? <div className="as-settings-empty">No key audit events yet.</div> : <div className="as-audit-list">{audit.map((entry) => <div key={entry.id}><span>{entry.event_type || 'event'}</span><strong>{entry.notes || entry.api_key_id || 'Credential event'}</strong><small>{relativeTime(entry.created_at)}</small></div>)}</div>}
      </div>

      {validation && (
        <div className="as-settings-card as-validation-card">
          <div className="as-settings-card-head"><div>{validation.ok ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}<div><strong>{validation.ok ? 'Validation passed' : 'Validation failed'}</strong><small>{validation.provider || target?.provider || provider}</small></div></div><button className="text" onClick={() => setValidation(null)}><X size={14} /></button></div>
          <div className="as-validation-list">{(validation.checks || []).map((check) => <div key={check.id}><span className={check.status === 'pass' ? 'pass' : 'fail'}>{check.status}</span><strong>{check.id}</strong><small>{check.detail || ''}{check.latency_ms != null ? ` · ${check.latency_ms}ms` : ''}</small></div>)}</div>
        </div>
      )}

      {drawer && <div className="as-settings-drawer-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) resetDrawer(); }}>
        <aside className="as-settings-drawer" role="dialog" aria-modal="true">
          <div className="as-settings-drawer-head"><strong>{drawer === 'add' ? (category === 'provider' ? 'Add API key' : 'Add personal secret') : drawer === 'rotate' ? 'Rotate credential' : 'Reveal credential'}</strong><button onClick={resetDrawer}><X size={17} /></button></div>

          {drawer === 'reveal' ? (
            <div className="as-settings-form">
              <div className="as-settings-banner warning"><AlertTriangle size={16} /><span>This value is visible for {revealSeconds}s and the reveal has been audited.</span></div>
              <label>Secret value<textarea className="secret-reveal" readOnly value={revealed || 'Expired — reveal again if needed.'} /></label>
              <button className="secondary full" type="button" onClick={() => void copyReveal()} disabled={!revealed}><Clipboard size={15} />Copy</button>
            </div>
          ) : (
            <div className="as-settings-form">
              {drawer === 'add' && <>
                <label>Type<select value={category} onChange={(event) => setCategory(event.target.value as 'provider' | 'personal')}><option value="provider">Provider key</option><option value="personal">Personal secret</option></select></label>
                {category === 'provider' ? <label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}>{providers.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : <label>Secret name<input value={secretName} onChange={(event) => setSecretName(event.target.value)} placeholder="MY_PRIVATE_TOKEN" autoComplete="off" /></label>}
                <label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={category === 'provider' ? `${providers.find((item) => item.id === provider)?.label || 'Provider'} production key` : 'Personal secret'} autoComplete="off" /></label>
                {provider === 'cloudflare' && category === 'provider' && <label>Cloudflare Account ID<input value={cloudflareAccountId} onChange={(event) => setCloudflareAccountId(event.target.value)} placeholder="32-character account ID" autoComplete="off" /></label>}
              </>}
              <label>{drawer === 'rotate' ? 'New secret value' : 'Secret value'}<input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} autoComplete="new-password" spellCheck={false} /></label>
              {drawer === 'add' && category === 'provider' && <label className="as-check-row"><input type="checkbox" checked={validateOnSave} onChange={(event) => setValidateOnSave(event.target.checked)} /><span>Test connection before saving</span></label>}
              <p className="as-settings-help">The raw value is never stored in browser storage and is cleared from this form after the request completes.</p>
              <div className="as-settings-drawer-footer"><button className="secondary" onClick={resetDrawer}>Cancel</button><button className="primary" disabled={saving || !secretValue} onClick={() => void (drawer === 'rotate' ? rotate() : saveNew())}>{saving ? 'Saving…' : drawer === 'rotate' ? 'Rotate' : 'Save'}</button></div>
            </div>
          )}
        </aside>
      </div>}
    </section>
  );
};

export default KeysSettings;
