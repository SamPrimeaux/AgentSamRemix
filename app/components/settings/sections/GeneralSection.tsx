import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Toggle, formatVaultCreated } from '../settingsUi';
import type { SettingsPanelModel } from '../hooks/useSettingsData';
import { parsePolicySettingsJson } from '../components/agentsSectionHelpers';
import type { AgentsamUserPolicy } from '../types';
import { notifyShellPrefChange } from '../../../config/shellChrome';

const PREF_KEYS = {
  sync_layouts: 'iam_pref_sync_layouts',
  show_status_bar: 'iam_pref_show_status_bar',
  autohide_editor: 'iam_pref_autohide_editor',
  autoinject_code: 'iam_pref_autoinject_code',
} as const;

type PrefApiKey = keyof typeof PREF_KEYS;

const TIMEZONE_OPTIONS = [
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
];

const fieldClass =
  'w-full px-3 py-2 rounded-xl bg-[var(--dashboard-card)] border border-[var(--dashboard-border)] text-[12px] text-[var(--dashboard-text)] focus:outline-none focus:border-[var(--solar-cyan)]/50';

type ProfilePayload = {
  display_name?: string;
  full_name?: string;
  avatar_url?: string | null;
  primary_email?: string;
  backup_email?: string;
  phone?: string;
  bio?: string;
  timezone?: string;
  language?: string;
  primary_email_verified?: number | boolean;
};

function readStoredBool(storageKey: string, defaultOn: boolean) {
  try {
    const v = localStorage.getItem(storageKey);
    if (v === null) return defaultOn;
    return v === '1' || v === 'true';
  } catch {
    return defaultOn;
  }
}

function initialsFromName(name: string, email: string) {
  const n = name.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }
  const local = email.split('@')[0] || '?';
  return local.slice(0, 2).toUpperCase();
}

export type GeneralSectionProps = {
  workspaceId?: string | null;
  data?: Pick<SettingsPanelModel, 'user' | 'profileEmail'>;
};

export function GeneralSection({ workspaceId, data }: GeneralSectionProps) {
  const navigate = useNavigate();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [primaryEmailVerified, setPrimaryEmailVerified] = useState(false);
  const [backupEmail, setBackupEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [timezone, setTimezone] = useState('America/Chicago');
  const [language, setLanguage] = useState('en');

  const [syncLayouts, setSyncLayouts] = useState(true);
  const [showStatusBar, setShowStatusBar] = useState(false);
  const [autohideEditor, setAutohideEditor] = useState(false);
  const [autoinjectCode, setAutoinjectCode] = useState(true);

  const [conversationDensity, setConversationDensity] = useState<'detailed' | 'minimal'>('detailed');
  const [completionSound, setCompletionSound] = useState(false);
  const [prDestination, setPrDestination] = useState<'github_web' | 'github_desktop' | 'ide'>('github_web');
  const [policySettingsRaw, setPolicySettingsRaw] = useState<string | null>(null);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);

  const authUser = data?.user ?? null;
  const loginEmail = authUser?.email ?? data?.profileEmail ?? primaryEmail;

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const r = await fetch('/api/settings/profile', { credentials: 'same-origin' });
      const d = (await r.json().catch(() => ({}))) as ProfilePayload & { error?: string };
      if (!r.ok) throw new Error(typeof d.error === 'string' ? d.error : `Load failed (${r.status})`);
      setDisplayName(String(d.display_name ?? '').trim());
      setFullName(String(d.full_name ?? '').trim());
      setAvatarUrl(d.avatar_url ? String(d.avatar_url).trim() : null);
      setPrimaryEmail(String(d.primary_email ?? '').trim());
      setPrimaryEmailVerified(!!d.primary_email_verified);
      setBackupEmail(String(d.backup_email ?? '').trim());
      setPhone(String(d.phone ?? '').trim());
      setBio(String(d.bio ?? '').trim());
      setTimezone(String(d.timezone ?? '').trim() || 'America/Chicago');
      setLanguage(String(d.language ?? '').trim() || 'en');
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
    setSyncLayouts(readStoredBool(PREF_KEYS.sync_layouts, true));
    setShowStatusBar(readStoredBool(PREF_KEYS.show_status_bar, false));
    setAutohideEditor(readStoredBool(PREF_KEYS.autohide_editor, false));
    setAutoinjectCode(readStoredBool(PREF_KEYS.autoinject_code, true));
  }, [loadProfile]);

  const loadUserPolicy = useCallback(async () => {
    try {
      const qp =
        workspaceId && workspaceId.trim()
          ? `?workspace_id=${encodeURIComponent(workspaceId.trim())}`
          : '';
      const r = await fetch(`/api/settings/user-policy${qp}`, { credentials: 'same-origin' });
      if (!r.ok) return;
      const d = (await r.json()) as { policy?: AgentsamUserPolicy & Record<string, unknown> };
      const row = d.policy;
      if (!row || typeof row !== 'object') return;
      if (row.sync_layouts != null) setSyncLayouts(Number(row.sync_layouts) === 1);
      if (row.show_status_bar != null) setShowStatusBar(Number(row.show_status_bar) === 1);
      if (row.autohide_editor != null) setAutohideEditor(Number(row.autohide_editor) === 1);
      if (row.autoinject_code != null) setAutoinjectCode(Number(row.autoinject_code) === 1);
      const rawJson = row.settings_json != null ? String(row.settings_json) : null;
      setPolicySettingsRaw(rawJson);
      const sj = parsePolicySettingsJson(rawJson);
      if (sj.conversation_density === 'minimal') setConversationDensity('minimal');
      else setConversationDensity('detailed');
      setCompletionSound(Boolean(sj.completion_sound));
      const pr = String(sj.pr_destination || 'github_web').toLowerCase();
      if (pr === 'github_desktop' || pr === 'ide') setPrDestination(pr);
      else setPrDestination('github_web');
    } catch {
      /* keep localStorage defaults */
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadUserPolicy();
  }, [loadUserPolicy]);

  const patchUserPolicyFireAndForget = (body: Record<string, unknown>) => {
    try {
      void fetch('/api/settings/user-policy', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId?.trim() || '',
          ...body,
        }),
      });
    } catch {
      /* ignore */
    }
  };

  const persistToggle = (storageKey: string, apiKey: PrefApiKey, value: boolean) => {
    try {
      localStorage.setItem(storageKey, value ? '1' : '0');
    } catch {
      /* ignore */
    }
    notifyShellPrefChange(storageKey);
    patchUserPolicyFireAndForget({ [apiKey]: value ? 1 : 0 });
  };

  const patchPolicySettingsJson = (patch: Record<string, unknown>) => {
    const current = parsePolicySettingsJson(policySettingsRaw);
    const nextJson = JSON.stringify({ ...current, ...patch });
    setPolicySettingsRaw(nextJson);
    try {
      void fetch('/api/settings/agents/policy', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId?.trim() || '',
          policy: { settings_json: nextJson },
        }),
      });
    } catch {
      /* ignore */
    }
  };

  const onAvatarPick = async (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) {
      setSaveError('Please choose an image file');
      return;
    }
    setAvatarUploading(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/settings/profile/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.error === 'string' ? d.error : 'Avatar upload failed');
      if (d.avatar_url) setAvatarUrl(String(d.avatar_url));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Avatar upload failed');
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const onSaveProfile = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const r = await fetch('/api/settings/profile', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          full_name: fullName,
          avatar_url: avatarUrl,
          backup_email: backupEmail,
          phone,
          bio,
          timezone,
          language,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.error === 'string' ? d.error : `Save failed (${r.status})`);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const rows: Array<{
    label: string;
    desc: string;
    on: boolean;
    setOn: (v: boolean) => void;
    storageKey: string;
    apiKey: PrefApiKey;
  }> = [
    {
      label: 'Sync layouts across windows',
      desc: 'All windows share the same panel layout',
      on: syncLayouts,
      setOn: setSyncLayouts,
      storageKey: PREF_KEYS.sync_layouts,
      apiKey: 'sync_layouts',
    },
    {
      label: 'Show Status Bar',
      desc: 'Git and editor context bar at the bottom when a file is open in Agent editor',
      on: showStatusBar,
      setOn: setShowStatusBar,
      storageKey: PREF_KEYS.show_status_bar,
      apiKey: 'show_status_bar',
    },
    {
      label: 'Auto-hide editor when empty',
      desc: 'Expand chat when all editors are closed',
      on: autohideEditor,
      setOn: setAutohideEditor,
      storageKey: PREF_KEYS.autohide_editor,
      apiKey: 'autohide_editor',
    },
    {
      label: 'Auto-inject code to Monaco',
      desc: 'Agent code blocks auto-open in editor',
      on: autoinjectCode,
      setOn: setAutoinjectCode,
      storageKey: PREF_KEYS.autoinject_code,
      apiKey: 'autoinject_code',
    },
  ];

  const avatarLabel = displayName || fullName || primaryEmail;

  return (
    <div className="flex flex-col gap-5 w-full max-w-none px-6">
      <h2 className="text-[13px] font-bold text-[var(--text-heading)] uppercase tracking-widest">General</h2>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-4">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted">
          Profile
        </div>

        {profileLoading ? (
          <div className="flex items-center gap-2 text-[11px] text-muted py-4">
            <Loader2 size={14} className="animate-spin" />
            Loading profile…
          </div>
        ) : profileError ? (
          <div className="text-[11px] text-red-400 py-2">{profileError}</div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
                className="relative w-16 h-16 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-app)] overflow-hidden shrink-0 hover:border-[var(--solar-cyan)]/50 transition-colors disabled:opacity-60"
                title="Upload avatar"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="flex items-center justify-center w-full h-full text-[13px] font-bold text-[var(--solar-cyan)]">
                    {initialsFromName(avatarLabel, primaryEmail)}
                  </span>
                )}
                {avatarUploading ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 size={18} className="animate-spin text-white" />
                  </span>
                ) : null}
              </button>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-main">Avatar</div>
                <div className="text-[11px] text-muted mt-0.5">Click to upload via Cloudflare Images</div>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onAvatarPick(e.target.files?.[0] ?? null)}
              />
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-muted">Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={fieldClass}
                autoComplete="nickname"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-muted">Full name</span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={fieldClass}
                autoComplete="name"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-muted">Primary email</span>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={primaryEmail}
                  readOnly
                  className={`${fieldClass} opacity-80 cursor-not-allowed`}
                />
                {primaryEmailVerified ? (
                  <span
                    className="shrink-0 flex items-center gap-1 text-[10px] text-emerald-400"
                    title="Verified"
                  >
                    <Check size={14} />
                  </span>
                ) : null}
              </div>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-muted">Backup email</span>
              <input
                type="email"
                value={backupEmail}
                onChange={(e) => setBackupEmail(e.target.value)}
                className={fieldClass}
                autoComplete="email"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-muted">Phone</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={fieldClass}
                autoComplete="tel"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-muted">Bio</span>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className={`${fieldClass} resize-y min-h-[72px]`}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-muted">Timezone</span>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={fieldClass}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-muted">Language</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={fieldClass}
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => void onSaveProfile()}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-[var(--solar-cyan)] text-black text-[12px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saveOk ? (
                <span className="text-[11px] text-emerald-400">Profile saved</span>
              ) : null}
              {saveError ? <span className="text-[11px] text-red-400">{saveError}</span> : null}
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-4">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted">
          Sign-in &amp; password
        </div>

        <section className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">
            Login email
          </h3>
          <p className="text-[11px] text-muted">
            Current: {loginEmail || '—'}
          </p>
          {!showEmailForm ? (
            <button
              type="button"
              onClick={() => {
                setEmailMsg(null);
                setShowEmailForm(true);
              }}
              className="px-4 py-2 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30 hover:bg-[var(--solar-cyan)]/30"
            >
              Change login email
            </button>
          ) : (
            <form
              className="grid gap-3 max-w-md"
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  setEmailLoading(true);
                  try {
                    const res = await fetch('/api/auth/email-change/request', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ newEmail }),
                      credentials: 'include',
                    });
                    const json = (await res.json().catch(() => ({}))) as { error?: string };
                    if (res.ok) {
                      setEmailMsg({
                        ok: true,
                        text: 'Check your inbox to confirm the new address.',
                      });
                      setShowEmailForm(false);
                      setNewEmail('');
                    } else {
                      setEmailMsg({
                        ok: false,
                        text:
                          typeof json.error === 'string' ? json.error : 'Failed to send verification.',
                      });
                    }
                  } finally {
                    setEmailLoading(false);
                  }
                })();
              }}
            >
              <input
                type="email"
                autoComplete="email"
                placeholder="New email address"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className={fieldClass}
              />
              <button
                type="submit"
                disabled={emailLoading}
                className="px-4 py-2 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30 hover:bg-[var(--solar-cyan)]/30 disabled:opacity-40"
              >
                Send verification
              </button>
            </form>
          )}
          {emailMsg ? (
            <div
              className={`text-[11px] ${emailMsg.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}
            >
              {emailMsg.text}
            </div>
          ) : null}
        </section>

        <section className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">Password</h3>
          {authUser?.passwordMethod === 'oauth' ? (
            <p className="text-[11px] text-muted">
              You sign in via {authUser?.provider ?? 'external provider'}. No password set.
            </p>
          ) : !authUser ? (
            <p className="text-[11px] text-muted">Loading account…</p>
          ) : (
            <>
              <p className="text-[11px] text-muted">
                Last changed:{' '}
                {authUser?.passwordUpdatedAt ? formatVaultCreated(authUser.passwordUpdatedAt) : '—'}
              </p>
              {!showPasswordForm ? (
                <button
                  type="button"
                  onClick={() => {
                    setPwMsg(null);
                    setShowPasswordForm(true);
                  }}
                  className="px-4 py-2 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30 hover:bg-[var(--solar-cyan)]/30"
                >
                  Change password
                </button>
              ) : (
                <form
                  className="grid gap-3 max-w-md"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void (async () => {
                      if (pwNew.length < 10) {
                        setPwMsg({ ok: false, text: 'Min 10 characters' });
                        return;
                      }
                      if (pwNew !== pwConfirm) {
                        setPwMsg({ ok: false, text: 'Passwords do not match' });
                        return;
                      }
                      setPwLoading(true);
                      try {
                        const res = await fetch('/api/auth/password-change', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
                          credentials: 'include',
                        });
                        const json = (await res.json().catch(() => ({}))) as { error?: string };
                        if (res.ok) {
                          setPwMsg({ ok: true, text: 'Password updated.' });
                          setShowPasswordForm(false);
                          setPwCurrent('');
                          setPwNew('');
                          setPwConfirm('');
                        } else {
                          setPwMsg({
                            ok: false,
                            text: typeof json.error === 'string' ? json.error : 'Failed to update password.',
                          });
                        }
                      } finally {
                        setPwLoading(false);
                      }
                    })();
                  }}
                >
                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Current password"
                    value={pwCurrent}
                    onChange={(e) => setPwCurrent(e.target.value)}
                    className={fieldClass}
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="New password (min 10 chars)"
                    value={pwNew}
                    onChange={(e) => setPwNew(e.target.value)}
                    className={fieldClass}
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    value={pwConfirm}
                    onChange={(e) => setPwConfirm(e.target.value)}
                    className={fieldClass}
                  />
                  <button
                    type="submit"
                    disabled={pwLoading}
                    className="px-4 py-2 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30 hover:bg-[var(--solar-cyan)]/30 disabled:opacity-40"
                  >
                    Save new password
                  </button>
                </form>
              )}
              {pwMsg ? (
                <div
                  className={`text-[11px] ${pwMsg.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}
                >
                  {pwMsg.text}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted">
          Layout
        </div>
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between py-3 border-b border-[var(--border-subtle)]/50 last:border-0"
          >
            <div>
              <div className="text-[12px] font-semibold text-main">{row.label}</div>
              <div className="text-[11px] text-muted mt-0.5">{row.desc}</div>
            </div>
            <Toggle
              on={row.on}
              onChange={(v) => {
                row.setOn(v);
                persistToggle(row.storageKey, row.apiKey, v);
              }}
            />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-4">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted">
          Preferences
        </div>
        <label className="block space-y-1 max-w-md">
          <span className="text-[11px] font-semibold text-muted">Conversation density</span>
          <select
            value={conversationDensity}
            onChange={(e) => {
              const v = e.target.value === 'minimal' ? 'minimal' : 'detailed';
              setConversationDensity(v);
              patchPolicySettingsJson({ conversation_density: v });
            }}
            className={fieldClass}
          >
            <option value="detailed">Detailed</option>
            <option value="minimal">Minimal</option>
          </select>
        </label>
        <div className="flex items-center justify-between py-2">
          <div>
            <div className="text-[12px] font-semibold text-main">Completion sound</div>
            <div className="text-[11px] text-muted mt-0.5">Play a sound when the agent finishes</div>
          </div>
          <Toggle
            on={completionSound}
            onChange={(v) => {
              setCompletionSound(v);
              patchPolicySettingsJson({ completion_sound: v });
            }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted mb-3">
          Notifications
        </div>
        <p className="text-[11px] text-muted mb-3">
          Deployment alerts, agent errors, spend thresholds, and webhook delivery.
        </p>
        <button
          type="button"
          onClick={() => navigate('/dashboard/settings/notifications')}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--solar-cyan)] hover:underline"
        >
          Manage notifications →
        </button>
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-4">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted">
          PR preferences
        </div>
        <label className="block space-y-1 max-w-md">
          <span className="text-[11px] font-semibold text-muted">Preferred PR destination</span>
          <select
            value={prDestination}
            onChange={(e) => {
              const v = e.target.value as 'github_web' | 'github_desktop' | 'ide';
              setPrDestination(v);
              patchPolicySettingsJson({ pr_destination: v });
            }}
            className={fieldClass}
          >
            <option value="github_web">GitHub Web</option>
            <option value="github_desktop">GitHub Desktop</option>
            <option value="ide">IDE</option>
          </select>
        </label>
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">
              Manage account
            </div>
            <div className="text-[12px] font-semibold text-main">Plan &amp; billing</div>
            <div className="text-[11px] text-muted mt-0.5">Billing, seats, and usage limits</div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/dashboard/settings/billing')}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-lg text-[11px] hover:border-[var(--solar-cyan)]/50 transition-colors shrink-0"
          >
            Open <ExternalLink size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}
