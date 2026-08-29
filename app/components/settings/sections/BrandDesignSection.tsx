import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Github, Loader2, Save, Trash2, X } from 'lucide-react';
import { SectionHeader } from '../components/SectionPrimitives';

export type BrandDesignSectionProps = { workspaceId?: string | null };

type DesignAsset = {
  id: string;
  kind: string;
  name: string;
  content_type: string;
  size: number;
  r2_key: string;
  created_at: number;
  download_url?: string;
};

type DesignProfile = {
  name: string;
  blurb: string;
  notes: string;
  github_references: string[];
  assets: DesignAsset[];
};

const EMPTY_PROFILE: DesignProfile = {
  name: '',
  blurb: '',
  notes: '',
  github_references: [],
  assets: [],
};

function bytesLabel(value: number) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeProfile(value: unknown): DesignProfile {
  const row = value && typeof value === 'object' ? (value as Partial<DesignProfile>) : {};
  return {
    name: String(row.name || ''),
    blurb: String(row.blurb || ''),
    notes: String(row.notes || ''),
    github_references: Array.isArray(row.github_references)
      ? row.github_references.map(String).filter(Boolean)
      : [],
    assets: Array.isArray(row.assets) ? (row.assets as DesignAsset[]) : [],
  };
}

function inputClass() {
  return 'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2.5 text-[12px] text-main outline-none focus:border-[var(--solar-blue)]/70';
}

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-3">
      <div>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">{title}</h3>
        {description ? <p className="mt-1 text-[11px] text-muted max-w-2xl">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function BrandDesignSection({ workspaceId }: BrandDesignSectionProps) {
  const wsId = workspaceId?.trim() || '';
  const [profile, setProfile] = useState<DesignProfile>(EMPTY_PROFILE);
  const [githubDraft, setGithubDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'figma' | 'brand_asset' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const figInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);

  const query = useMemo(() => (wsId ? `?workspace_id=${encodeURIComponent(wsId)}` : ''), [wsId]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/settings/design${query}`, { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as { error?: string; design_profile?: DesignProfile };
      if (!res.ok) throw new Error(body.error || `Unable to load design settings (${res.status})`);
      setProfile(normalizeProfile(body.design_profile));
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to load design settings' });
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/design', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(wsId ? { workspace_id: wsId } : {}),
          design_profile: {
            name: profile.name,
            blurb: profile.blurb,
            notes: profile.notes,
            github_references: profile.github_references,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; design_profile?: DesignProfile };
      if (!res.ok) throw new Error(body.error || `Save failed (${res.status})`);
      setProfile(normalizeProfile(body.design_profile));
      setMessage({ tone: 'ok', text: 'Brand & design settings saved.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const addGithubReference = () => {
    const value = githubDraft.trim();
    if (!value) return;
    if (profile.github_references.includes(value)) {
      setGithubDraft('');
      return;
    }
    setProfile((prev) => ({ ...prev, github_references: [...prev.github_references, value] }));
    setGithubDraft('');
  };

  const uploadAsset = async (file: File, kind: 'figma' | 'brand_asset') => {
    setUploading(kind);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('kind', kind);
      if (wsId) form.append('workspace_id', wsId);
      const res = await fetch('/api/settings/design/assets', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; design_profile?: DesignProfile };
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
      setProfile(normalizeProfile(body.design_profile));
      setMessage({ tone: 'ok', text: `${file.name} added to this workspace.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Upload failed' });
    } finally {
      setUploading(null);
      if (figInputRef.current) figInputRef.current.value = '';
      if (assetInputRef.current) assetInputRef.current.value = '';
    }
  };

  const removeAsset = async (asset: DesignAsset) => {
    setMessage(null);
    try {
      const suffix = wsId ? `?workspace_id=${encodeURIComponent(wsId)}` : '';
      const res = await fetch(`/api/settings/design/assets/${encodeURIComponent(asset.id)}${suffix}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; design_profile?: DesignProfile };
      if (!res.ok) throw new Error(body.error || `Delete failed (${res.status})`);
      setProfile(normalizeProfile(body.design_profile));
      setMessage({ tone: 'ok', text: `${asset.name} removed.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Delete failed' });
    }
  };

  return (
    <div className="p-5 md:p-6 max-w-4xl mx-auto w-full space-y-4">
      <SectionHeader
        title="Brand & Design"
        description="Reusable workspace design context for Agent Sam, CMS scaffolding, Design Studio, Draw, and future generators."
        right={
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[11px] font-semibold text-main hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save changes
          </button>
        }
      />

      {message ? (
        <div
          className={`rounded-xl border px-3 py-2 text-[11px] ${
            message.tone === 'error'
              ? 'border-[var(--accent-danger)]/40 text-[var(--accent-danger)] bg-[var(--accent-danger)]/5'
              : 'border-[var(--accent-success)]/30 text-[var(--accent-success)] bg-[var(--accent-success)]/5'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {loading ? (
        <div className="h-40 flex items-center justify-center text-muted gap-2 text-[11px]">
          <Loader2 size={15} className="animate-spin" /> Loading design settings…
        </div>
      ) : (
        <>
          <Panel title="Design identity" description="Give generators a stable description of the company, product, or visual system they are building for.">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold text-main">Name</span>
              <input
                value={profile.name}
                onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))}
                className={inputClass()}
                placeholder="Inner Animal Media"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold text-main">Company / product blurb</span>
              <textarea
                rows={4}
                value={profile.blurb}
                onChange={(event) => setProfile((prev) => ({ ...prev, blurb: event.target.value }))}
                className={`${inputClass()} resize-y`}
                placeholder="What you build, who it is for, and the design qualities that should remain consistent."
              />
            </label>
          </Panel>

          <Panel title="Design references" description="Reference code and source material that Agent Sam or a generator can inspect when scaffolding a new interface or CMS site.">
            <div className="flex gap-2 max-phone:flex-col">
              <div className="relative flex-1">
                <Github size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={githubDraft}
                  onChange={(event) => setGithubDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addGithubReference();
                    }
                  }}
                  className={`${inputClass()} pl-9`}
                  placeholder="https://github.com/owner/repo"
                />
              </div>
              <button
                type="button"
                onClick={addGithubReference}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[11px] font-semibold text-main hover:bg-[var(--bg-hover)]"
              >
                Add reference
              </button>
            </div>
            {profile.github_references.length ? (
              <div className="flex flex-wrap gap-1.5">
                {profile.github_references.map((ref) => (
                  <span key={ref} className="inline-flex items-center gap-1.5 max-w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-[10px] text-main">
                    <span className="truncate">{ref}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${ref}`}
                      onClick={() => setProfile((prev) => ({ ...prev, github_references: prev.github_references.filter((value) => value !== ref) }))}
                      className="text-muted hover:text-main"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel title="Brand assets" description="Store reusable design source files with this workspace. Files are kept outside the settings JSON and referenced by the design profile.">
            <input
              ref={figInputRef}
              type="file"
              accept=".fig"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAsset(file, 'figma');
              }}
            />
            <input
              ref={assetInputRef}
              type="file"
              accept="image/*,.svg,.woff,.woff2,.ttf,.otf,.pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAsset(file, 'brand_asset');
              }}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => figInputRef.current?.click()}
                disabled={uploading !== null}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 text-left hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                <div>
                  <div className="text-[11px] font-semibold text-main">Figma source</div>
                  <div className="text-[10px] text-muted mt-0.5">Upload a .fig reference file</div>
                </div>
                {uploading === 'figma' ? <Loader2 size={15} className="animate-spin text-muted" /> : <FileUp size={15} className="text-muted" />}
              </button>
              <button
                type="button"
                onClick={() => assetInputRef.current?.click()}
                disabled={uploading !== null}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 text-left hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                <div>
                  <div className="text-[11px] font-semibold text-main">Logos, fonts & references</div>
                  <div className="text-[10px] text-muted mt-0.5">Images, SVG, fonts, or PDF</div>
                </div>
                {uploading === 'brand_asset' ? <Loader2 size={15} className="animate-spin text-muted" /> : <FileUp size={15} className="text-muted" />}
              </button>
            </div>

            {profile.assets.length ? (
              <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                {profile.assets.map((asset, index) => (
                  <div key={asset.id} className={`flex items-center gap-3 px-3 py-2.5 ${index ? 'border-t border-[var(--border-subtle)]' : ''}`}>
                    <FileUp size={13} className="text-muted shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-main truncate">{asset.name}</div>
                      <div className="text-[9px] uppercase tracking-wider text-muted mt-0.5">{asset.kind.replace('_', ' ')} · {bytesLabel(asset.size)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeAsset(asset)}
                      className="p-1.5 rounded text-muted hover:text-[var(--accent-danger)] hover:bg-[var(--bg-hover)]"
                      aria-label={`Remove ${asset.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel title="Creative instructions" description="Workspace-level preferences that should survive across CMS, Design Studio, Draw, and Agent Sam sessions.">
            <textarea
              rows={5}
              value={profile.notes}
              onChange={(event) => setProfile((prev) => ({ ...prev, notes: event.target.value }))}
              className={`${inputClass()} resize-y`}
              placeholder="e.g. Dark-first. Use CSS variables for color. Prioritize mobile layouts, accessibility, and restrained motion."
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {['Agent Sam', 'CMS', 'Design Studio', 'Draw'].map((label) => (
                <span key={label} className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-[9px] uppercase tracking-wider text-muted">
                  {label}
                </span>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
