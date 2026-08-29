import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Filter, RefreshCw, Save, Search } from 'lucide-react';

type Repo = { id?: number; full_name: string; private?: boolean; default_branch?: string | null };
type RuleRow = { id?: string; pattern: string; is_negation: number; order_index: number; source?: string | null };
type PolicyResponse = { ok: boolean; repo_full_name: string; text: string; patterns: RuleRow[]; version: string; error?: string };
type PreviewResponse = { ok?: boolean; ignored?: boolean; reason?: string; error?: string; path?: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `HTTP ${response.status}`) as Error & { status?: number; data?: any };
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data as T;
}

function parseDraft(text: string) {
  const seen = new Set<string>();
  const rows: Array<{ pattern: string; is_negation: number }> = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const isNegation = line.startsWith('!') ? 1 : 0;
    const pattern = (isNegation ? line.slice(1) : line).trim();
    if (!pattern) continue;
    const key = `${isNegation}:${pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ pattern, is_negation: isNegation });
  }
  return rows;
}

export const IndexRulesSettings: React.FC = () => {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState('');
  const [text, setText] = useState('');
  const [savedText, setSavedText] = useState('');
  const [version, setVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewPath, setPreviewPath] = useState('src/foo.js');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const dirty = text !== savedText;
  const draft = useMemo(() => parseDraft(text), [text]);
  const denyCount = draft.filter((row) => row.is_negation === 0).length;
  const allowCount = draft.filter((row) => row.is_negation === 1).length;

  const loadRepos = useCallback(async () => {
    const result = await api<{ repos: Repo[] }>('/api/settings/indexrules/repos');
    const next = result.repos || [];
    setRepos(next);
    setRepo((current) => current && next.some((item) => item.full_name === current) ? current : next[0]?.full_name || '');
    return next;
  }, []);

  const loadPolicy = useCallback(async (repoName: string) => {
    if (!repoName) {
      setText('');
      setSavedText('');
      setVersion('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api<PolicyResponse>(`/api/settings/indexrules?repo=${encodeURIComponent(repoName)}`);
      setText(result.text || '');
      setSavedText(result.text || '');
      setVersion(result.version || '');
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load index rules');
      setText('');
      setSavedText('');
      setVersion('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadRepos()
      .then((next) => { if (active && next[0]?.full_name) return loadPolicy(next[0].full_name); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : 'GitHub repository list failed'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadRepos, loadPolicy]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const changeRepo = async (next: string) => {
    if (dirty && !window.confirm('Discard unsaved index rule changes?')) return;
    setRepo(next);
    await loadPolicy(next);
  };

  const save = async () => {
    if (!repo) return;
    if (!draft.length) {
      setError('At least one deny or allow rule is required. Empty policies fail closed.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await api<PolicyResponse>('/api/settings/indexrules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo_full_name: repo, text, if_version: version }),
      });
      setText(result.text || text);
      setSavedText(result.text || text);
      setVersion(result.version || '');
      setNotice('Index rules saved. The code indexer will read this policy directly.');
    } catch (e: any) {
      if (e?.status === 409 && e?.data?.error === 'index_rules_conflict') {
        setError('These rules changed since you loaded them. Reload before saving so another edit is not overwritten.');
      } else {
        setError(e instanceof Error ? e.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    if (!repo || !previewPath.trim()) return;
    setError('');
    try {
      const result = await api<PreviewResponse>('/api/settings/indexrules/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo_full_name: repo, path: previewPath }),
      });
      setPreview(result);
    } catch (e: any) {
      setPreview(e?.data || { ok: false, error: e instanceof Error ? e.message : 'Preview failed' });
    }
  };

  return (
    <section className="as-settings-section">
      <div className="as-settings-header">
        <div>
          <span className="as-settings-kicker">INDEX RULES</span>
          <h1>Repository indexing policy</h1>
          <p>The code indexer reads this D1 policy directly. Deny rules exclude paths; prefix a rule with <code>!</code> to create an explicit allow scope.</p>
        </div>
        <div className="as-settings-actions">
          <button className="secondary" type="button" onClick={() => void loadPolicy(repo)} disabled={!repo || loading}><RefreshCw size={15} />Refresh</button>
          <button className="primary" type="button" onClick={() => void save()} disabled={!dirty || saving || !repo}><Save size={15} />{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {error && <div className="as-settings-banner danger"><AlertTriangle size={16} /><span>{error}</span></div>}
      {notice && <div className="as-settings-banner success"><CheckCircle2 size={16} /><span>{notice}</span></div>}

      <div className="as-index-toolbar">
        <Filter size={15} />
        <select value={repo} onChange={(event) => void changeRepo(event.target.value)} disabled={loading || repos.length === 0}>
          {repos.length === 0 ? <option value="">No GitHub repositories available</option> : repos.map((item) => <option key={item.full_name} value={item.full_name}>{item.full_name}{item.private ? ' · private' : ''}</option>)}
        </select>
        <span>{denyCount} deny · {allowCount} allow</span>
        {dirty && <strong>Unsaved</strong>}
      </div>

      <div className="as-index-layout">
        <div className="as-settings-card as-index-editor-card">
          <div className="as-settings-card-head">
            <div><Filter size={17} /><div><strong>.agentsamignore</strong><small>{repo || 'Choose a repository'}</small></div></div>
            <span className="as-version-chip">{version ? `v ${version.slice(0, 8)}` : 'no saved policy'}</span>
          </div>
          {loading ? <div className="as-settings-empty">Loading index policy…</div> : (
            <div className="as-code-textarea-wrap">
              <div className="as-line-numbers" aria-hidden="true">{text.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder={'# Exclude generated/dependency paths\nnode_modules/**\ndist/**\n.git/**\n\n# Optional allow scope\n!app/**\n!backend/**'}
                aria-label="Index rules editor"
              />
            </div>
          )}
          <div className="as-index-editor-foot">
            <span>Max 500 rules · 1,024 characters per rule · saves are conflict protected.</span>
            <button className="primary" type="button" onClick={() => void save()} disabled={!dirty || saving || !repo}><Save size={14} />Save rules</button>
          </div>
        </div>

        <div className="as-index-side">
          <div className="as-settings-card">
            <div className="as-settings-card-head"><div><Search size={17} /><div><strong>Preview a path</strong><small>Uses the saved server policy, not the unsaved draft.</small></div></div></div>
            <div className="as-preview-row"><input value={previewPath} onChange={(event) => setPreviewPath(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runPreview(); }} placeholder="src/foo.js" /><button className="secondary" onClick={() => void runPreview()} disabled={!repo}>Check</button></div>
            {preview && <div className={`as-preview-result ${preview.ignored ? 'blocked' : 'allowed'}`}><strong>{preview.ignored ? 'Ignored' : preview.ok ? 'Included' : 'Unavailable'}</strong><span>{preview.reason || preview.error || 'No reason returned'}</span></div>}
          </div>

          <div className="as-settings-card">
            <div className="as-settings-card-head"><div><Filter size={17} /><div><strong>Parsed draft</strong><small>What this editor currently contains.</small></div></div></div>
            {draft.length === 0 ? <div className="as-settings-empty">No rules in the draft. Saving an empty policy is rejected.</div> : <div className="as-rule-list">{draft.slice(0, 16).map((row, index) => <div key={`${row.is_negation}:${row.pattern}:${index}`}><span className={row.is_negation ? 'allow' : 'deny'}>{row.is_negation ? 'ALLOW' : 'DENY'}</span><code>{row.pattern}</code></div>)}{draft.length > 16 && <small>+ {draft.length - 16} more rules</small>}</div>}
          </div>
        </div>
      </div>
    </section>
  );
};

export default IndexRulesSettings;
