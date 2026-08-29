import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Filter, RefreshCw } from 'lucide-react';
import type { GitRepo } from '../types';
import { EmptyState, LoadingRow, SectionHeader } from '../components/SectionPrimitives';

export type IndexRulesSectionProps = {
  repos: GitRepo[];
};

type IndexRulePattern = {
  id?: string;
  pattern: string;
  is_negation: 0 | 1;
  order_index: number;
  source?: string | null;
  updated_at_unix?: number | null;
};

type IndexRulesResponse = {
  ok: boolean;
  repo_full_name: string;
  patterns: IndexRulePattern[];
  text: string;
  warnings?: Array<{ code: string; message: string; severity: string }>;
  error?: string;
};

type ParsedPreviewRow = {
  pattern: string;
  is_negation: 0 | 1;
  order_index: number;
  source: string;
};

type PathCheckResult = { ignored: boolean; reason: string | null };

const STARTER_TEXT =
  '# One glob per line. Lines starting with ! are allow rules.\n# Example:\n# node_modules/**\n# dist/**\n# !src/**\n';

function parsePreview(text: string, saved: IndexRulePattern[]): ParsedPreviewRow[] {
  const savedMap = new Map<string, string>(
    saved.map((p) => [`${p.is_negation}:${p.pattern}`, p.source || 'settings_ui']),
  );
  const lines = text.split(/\r\n|\r|\n/);
  const out: ParsedPreviewRow[] = [];
  const seen = new Set<string>();
  let order = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const isNeg: 0 | 1 = line.startsWith('!') ? 1 : 0;
    const pattern = (isNeg ? line.slice(1) : line).trim();
    if (!pattern) continue;
    const key = `${isNeg}:${pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pattern, is_negation: isNeg, order_index: order, source: savedMap.get(key) || 'unsaved' });
    order += 1;
  }
  return out;
}

function SettingRow({
  title,
  description,
  onEdit,
}: {
  title: string;
  description: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-main">{title}</div>
        <div className="text-[11px] text-muted mt-0.5">{description}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 text-[11px] text-[var(--solar-cyan)] hover:underline"
      >
        Edit
      </button>
    </div>
  );
}

function LineNumberedEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const lineCount = Math.max(1, value.split('\n').length);
  const gutterRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const onScroll = () => {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  return (
    <div
      className="flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] overflow-hidden"
      style={{ height: 320 }}
    >
      <div
        ref={gutterRef}
        className="shrink-0 w-10 py-3 text-right pr-2 text-[11px] font-mono text-muted select-none overflow-hidden"
        style={{ background: 'var(--bg-panel)', borderRight: '1px solid var(--border-subtle)' }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} style={{ lineHeight: '20px' }}>
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={onScroll}
        spellCheck={false}
        className="flex-1 py-3 px-3 text-[11px] font-mono bg-transparent text-main outline-none resize-none"
        style={{ lineHeight: '20px' }}
      />
    </div>
  );
}

export function IndexRulesSection({ repos }: IndexRulesSectionProps) {
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [data, setData] = useState<IndexRulesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorText, setEditorText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [previewPath, setPreviewPath] = useState('');
  const [previewResult, setPreviewResult] = useState<PathCheckResult | string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    if (!selectedRepo && repos.length) setSelectedRepo(repos[0].repo_full_name);
  }, [repos, selectedRepo]);

  const load = async (repo: string) => {
    if (!repo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/settings/indexrules?repo=${encodeURIComponent(repo)}`, {
        credentials: 'same-origin',
      });
      const j = (await res.json().catch(() => ({}))) as IndexRulesResponse;
      if (!res.ok || j.ok === false) {
        throw new Error(j.error || `Load failed (${res.status})`);
      }
      setData(j);
      setEditorText(j.text || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load index rules');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedRepo) void load(selectedRepo);
    setEditorOpen(false);
    setSaveMsg(null);
    setPreviewResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo]);

  const patterns = data?.patterns || [];
  const denyCount = patterns.filter((p) => Number(p.is_negation) !== 1).length;
  const allowCount = patterns.filter((p) => Number(p.is_negation) === 1).length;
  const hasRows = patterns.length > 0;

  const previewRows = useMemo(() => parsePreview(editorText, patterns), [editorText, patterns]);

  const openEditor = () => {
    setEditorText(data?.text && data.text.trim() ? data.text : STARTER_TEXT);
    setEditorOpen(true);
    setSaveMsg(null);
  };

  const discard = () => {
    setEditorText(data?.text || '');
    setSaveMsg(null);
  };

  const save = async () => {
    if (!selectedRepo) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/settings/indexrules', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_full_name: selectedRepo, text: editorText }),
      });
      const j = (await res.json().catch(() => ({}))) as IndexRulesResponse & { message?: string };
      if (!res.ok || j.ok === false) {
        throw new Error(j.message || j.error || `Save failed (${res.status})`);
      }
      setData(j);
      setEditorText(j.text || '');
      setLastSavedAt(Date.now());
      setSaveMsg('Saved.');
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    if (!selectedRepo || !previewPath.trim()) return;
    setPreviewBusy(true);
    setPreviewResult(null);
    try {
      const res = await fetch('/api/settings/indexrules/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_full_name: selectedRepo, path: previewPath.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ignored?: boolean;
        reason?: string | null;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setPreviewResult(j.message || j.error || `Preview failed (${res.status})`);
      } else {
        setPreviewResult({ ignored: !!j.ignored, reason: j.reason ?? null });
      }
    } catch (e) {
      setPreviewResult(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <SectionHeader
        title="Index Rules"
        description="Ignore/allow policy the codebase indexer actually reads (agentsam_ignore_pattern). Parity with .cursorignore — deny by default, prefix a line with ! to allow-scope indexing to specific paths."
        right={
          <button
            type="button"
            onClick={() => selectedRepo && load(selectedRepo)}
            disabled={loading || !selectedRepo}
            className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={13} className="text-muted shrink-0" />
        <select
          value={selectedRepo}
          onChange={(e) => setSelectedRepo(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[11px] text-main min-w-[220px]"
        >
          {repos.length === 0 ? <option value="">No connected repos</option> : null}
          {repos.map((r) => (
            <option key={r.id} value={r.repo_full_name}>
              {r.repo_full_name}
            </option>
          ))}
        </select>
        {data ? (
          <span className="text-[10px] text-muted">
            {denyCount} deny · {allowCount} allow
          </span>
        ) : null}
      </div>

      {repos.length === 0 ? (
        <EmptyState message="No connected GitHub repos yet — connect one under GitHub settings first." />
      ) : null}

      {error ? (
        <div className="text-[11px] text-[var(--color-danger)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}

      {loading && !data ? <LoadingRow /> : null}

      {selectedRepo && !loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="flex flex-col gap-3">
            <SettingRow
              title="Ignore patterns"
              description="Exclude from indexing (deny). .cursorignore parity."
              onEdit={openEditor}
            />
            <SettingRow
              title="Allow scope"
              description="When any allow line exists, paths must match at least one (prefix a line with !)."
              onEdit={openEditor}
            />

            {!hasRows ? (
              <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-6 flex flex-col items-center gap-2 text-center">
                <div className="text-[11px] text-muted">
                  No ignore/allow patterns saved for {selectedRepo} yet. The indexer fails loud
                  until at least one pattern is saved.
                </div>
                <button
                  type="button"
                  onClick={openEditor}
                  className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--solar-cyan)]/50 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/10"
                >
                  Add patterns
                </button>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2.5">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted">
                Preview a path
              </div>
              <div className="flex gap-2">
                <input
                  value={previewPath}
                  onChange={(e) => setPreviewPath(e.target.value)}
                  placeholder="src/foo.js"
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[11px] font-mono text-main"
                />
                <button
                  type="button"
                  onClick={runPreview}
                  disabled={previewBusy || !previewPath.trim()}
                  className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-main hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {previewBusy ? 'Checking…' : 'Check'}
                </button>
              </div>
              {previewResult ? (
                typeof previewResult === 'string' ? (
                  <div className="text-[10px] text-[var(--color-danger)]">{previewResult}</div>
                ) : (
                  <div className="text-[10px] text-muted">
                    {previewResult.ignored ? (
                      <span className="text-[var(--color-warning)]">Ignored</span>
                    ) : (
                      <span className="text-[var(--color-success)]">Would index</span>
                    )}
                    {previewResult.reason ? ` — ${previewResult.reason}` : ''}
                  </div>
                )
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {editorOpen ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-mono text-main truncate">
                    .agentsamignore · {selectedRepo}
                  </div>
                  <div className="text-[10px] text-muted">
                    {lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : null}
                  </div>
                </div>
                <LineNumberedEditor value={editorText} onChange={setEditorText} />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--solar-cyan)]/50 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/10 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={discard}
                    disabled={saving}
                    className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main disabled:opacity-50"
                  >
                    Discard
                  </button>
                  {saveMsg ? <span className="text-[10px] text-muted">{saveMsg}</span> : null}
                </div>

                <div className="flex flex-col gap-1 mt-1">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted">
                    Live preview ({previewRows.length})
                  </div>
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto custom-scrollbar">
                    {previewRows.length === 0 ? (
                      <div className="text-[10px] text-muted italic">
                        No patterns yet — add at least one line before saving.
                      </div>
                    ) : (
                      previewRows.map((row) => (
                        <div
                          key={`${row.is_negation}:${row.pattern}`}
                          className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1"
                        >
                          <span
                            className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                              row.is_negation
                                ? 'text-[var(--color-success)] border border-[var(--color-success)]/40'
                                : 'text-[var(--color-danger)] border border-[var(--color-danger)]/40'
                            }`}
                          >
                            {row.is_negation ? 'Allow' : 'Deny'}
                          </span>
                          <span className="text-[10px] font-mono text-main truncate flex-1">
                            {row.pattern}
                          </span>
                          <span className="text-[9px] text-muted">#{row.order_index}</span>
                          <span className="text-[9px] text-muted">{row.source}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-10 flex items-center justify-center text-[11px] text-muted text-center">
                Click Edit to view and edit the ignore file for {selectedRepo || 'a repo'}.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
