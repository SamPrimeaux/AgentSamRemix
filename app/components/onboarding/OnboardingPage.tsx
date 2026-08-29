import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const SUGGEST_TOOLS = ['Cursor', 'Figma', 'Notion', 'VS Code', 'Slack', 'Linear', 'Vercel'];
const SUGGEST_AI = ['Claude', 'ChatGPT', 'Gemini', 'Copilot', 'Cursor AI', 'Perplexity'];
const SUGGEST_PLATFORMS = ['GitHub', 'Cloudflare', 'Vercel', 'AWS', 'GCP', 'Netlify'];

const TIMEZONES = [
  'America/Chicago',
  'America/New_York',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'UTC',
];

const shell: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-app)',
  color: 'rgba(200, 224, 232, 0.95)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  padding: '32px 20px 48px',
};

const card: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  background: 'var(--bg-panel, rgba(0,33,43,0.92))',
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
  padding: 28,
};

function TagInput(props: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (props.value.includes(t)) return;
    props.onChange([...props.value, t]);
    setDraft('');
  };
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--solar-cyan)', marginBottom: 8 }}>{props.label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {props.value.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => props.onChange(props.value.filter((x) => x !== t))}
            style={{
              border: '1px solid var(--border-subtle)',
              background: 'rgba(45,212,191,0.12)',
              color: 'var(--solar-cyan)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {t} ×
          </button>
        ))}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          }
        }}
        placeholder="Type and press Enter"
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 6,
          border: '1px solid var(--border-subtle)',
          background: 'rgba(0,26,34,0.6)',
          color: 'inherit',
          fontFamily: 'inherit',
        }}
      />
      {props.suggestions && props.suggestions.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {props.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              style={{
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid rgba(45,212,191,0.35)',
                background: 'transparent',
                color: 'rgba(180,210,220,0.9)',
                cursor: 'pointer',
              }}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function OnboardingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => (params.get('token') || '').trim(), [params]);
  const step = useMemo(() => (params.get('step') || 'intake').trim(), [params]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intakeUser, setIntakeUser] = useState<{ name: string; email: string } | null>(null);

  const [skill, setSkill] = useState<'beginner' | 'intermediate' | 'advanced' | 'expert'>('intermediate');
  const [currentStack, setCurrentStack] = useState<string[]>([]);
  const [favoriteTools, setFavoriteTools] = useState<string[]>([]);
  const [favoriteAi, setFavoriteAi] = useState<string[]>([]);
  const [favoritePlatforms, setFavoritePlatforms] = useState<string[]>([]);
  const [aspirations, setAspirations] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [published, setPublished] = useState<{ title: string; url: string; description: string }[]>([]);
  const [githubUsername, setGithubUsername] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [timezone, setTimezone] = useState('America/Chicago');

  const [backupEmail, setBackupEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [profileGithub, setProfileGithub] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryHad, setRecoveryHad] = useState(false);
  const [ackRecovery, setAckRecovery] = useState(false);
  const [localFiles, setLocalFiles] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadIntake = useCallback(async () => {
    if (!token || !/^[0-9a-f]{64}$/i.test(token)) {
      setError('Missing or invalid intake token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/onboarding/intake?token=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Could not load intake');
        setIntakeUser(null);
      } else {
        setIntakeUser(data.user || null);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (step === 'intake') void loadIntake();
    else setLoading(false);
  }, [step, loadIntake]);

  const loadRecovery = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding/recovery-codes', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRecoveryCodes(Array.isArray(data.codes) ? data.codes : null);
        setRecoveryHad(!!data.already_had_codes);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (step !== 'profile_setup') return;
    (async () => {
      try {
        const res = await fetch('/api/settings/profile', { credentials: 'include' });
        if (res.status === 401) {
          const next = `/onboarding?step=profile_setup`;
          navigate(`/auth/login?next=${encodeURIComponent(next)}`, { replace: true });
          return;
        }
      } catch {
        /* ignore */
      }
      void loadRecovery();
    })();
  }, [step, navigate, loadRecovery]);

  async function onSubmitIntake(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/onboarding/intake', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          skill_level: skill,
          current_stack: currentStack,
          favorite_tools: favoriteTools,
          favorite_ai: favoriteAi,
          favorite_platforms: favoritePlatforms,
          aspirations,
          goals,
          published_work: published
            .filter((p) => (p.title || '').trim() || (p.url || '').trim())
            .slice(0, 5),
          github_username: githubUsername,
          portfolio_url: portfolioUrl,
          communication_pref: 'email',
          timezone,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Intake failed');
        return;
      }
      const next = typeof data.next === 'string' ? data.next : '/onboarding?step=profile_setup';
      navigate(next, { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  async function onAvatarFile(file: File | null) {
    if (!file) return;
    const ext = (file.type || '').includes('png') ? 'png' : (file.type || '').includes('webp') ? 'webp' : 'jpg';
    const key = `avatars/onboarding/${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const res = await fetch(`/api/r2/upload?bucket=${encodeURIComponent('agent-sam')}&key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      credentials: 'include',
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) setAvatarUrl(String(data.url));
  }

  async function onSubmitProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!ackRecovery) {
      setError('Confirm you have saved your recovery codes.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/onboarding/profile-setup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backup_email: backupEmail || undefined,
          phone: phone || undefined,
          github_username: profileGithub || undefined,
          avatar_url: avatarUrl || undefined,
          recovery_codes_acknowledged: true,
          local_file_access: localFiles,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Profile setup failed');
        return;
      }
      navigate('/onboarding?step=complete', { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  const ghStart = `/api/oauth/github/start?return_to=${encodeURIComponent(`${window.location.origin}/onboarding?step=profile_setup`)}`;

  if (step === 'complete') {
    return (
      <div style={shell}>
        <div style={card}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: 'var(--solar-cyan)', marginBottom: 12 }}>ONBOARDING</div>
          <h1 style={{ fontWeight: 400, fontFamily: 'Georgia, serif', margin: '0 0 16px', color: '#e8f4f8' }}>You&apos;re all set</h1>
          <p style={{ color: 'rgba(180,200,210,0.9)', lineHeight: 1.7, marginBottom: 24 }}>
            Intake and profile setup are saved. Your workspace preferences, recovery codes, and Agent Sam profile are configured for this account.
          </p>
          <ul style={{ color: 'rgba(160,190,200,0.88)', fontSize: 13, lineHeight: 1.8, marginBottom: 28 }}>
            <li>Skill profile and goals synced to Agent Sam</li>
            <li>Security baseline (recovery codes) in place</li>
            <li>Tenant activation progress updated</li>
          </ul>
          <a
            href="/dashboard/agent"
            style={{
              display: 'inline-block',
              padding: '12px 28px',
              background: 'var(--solar-cyan)',
              color: '#00212b',
              textDecoration: 'none',
              borderRadius: 6,
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            Open Agent Sam
          </a>
        </div>
      </div>
    );
  }

  if (step === 'profile_setup') {
    return (
      <div style={shell}>
        <div style={card}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: 'var(--solar-cyan)', marginBottom: 12 }}>PROFILE SETUP</div>
          <h1 style={{ fontWeight: 400, fontFamily: 'Georgia, serif', margin: '0 0 20px', color: '#e8f4f8' }}>Identity &amp; security</h1>
          <form onSubmit={onSubmitProfile}>
            <label style={labelStyle}>Backup email</label>
            <input value={backupEmail} onChange={(e) => setBackupEmail(e.target.value)} style={inputStyle} type="email" />

            <label style={labelStyle}>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} type="tel" />

            <label style={labelStyle}>GitHub username (optional)</label>
            <input value={profileGithub} onChange={(e) => setProfileGithub(e.target.value)} style={inputStyle} />

            <label style={labelStyle}>Avatar</label>
            <input type="file" accept="image/*" onChange={(e) => void onAvatarFile(e.target.files?.[0] || null)} style={{ marginBottom: 12 }} />
            {avatarUrl ? <div style={{ fontSize: 12, marginBottom: 16, wordBreak: 'break-all' }}>Uploaded: {avatarUrl}</div> : null}

            <div style={{ margin: '20px 0' }}>
              <a
                href={ghStart}
                style={{
                  display: 'inline-block',
                  padding: '10px 18px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  color: 'var(--solar-cyan)',
                  textDecoration: 'none',
                  fontSize: 13,
                }}
              >
                Connect GitHub
              </a>
            </div>

            <div style={{ margin: '24px 0', padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'rgba(0,26,34,0.5)' }}>
              <div style={{ fontSize: 12, color: 'var(--solar-cyan)', marginBottom: 8 }}>Recovery codes</div>
              {recoveryHad && !recoveryCodes?.length ? (
                <p style={{ fontSize: 12, color: 'rgba(180,200,210,0.9)' }}>Existing codes already on file. Rotate from account security if you need new ones.</p>
              ) : (
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'rgba(220,240,245,0.95)' }}>
                  {(recoveryCodes || []).join('\n')}
                </pre>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={ackRecovery} onChange={(e) => setAckRecovery(e.target.checked)} />
                I&apos;ve saved these codes somewhere safe
              </label>
            </div>

            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={localFiles} onChange={(e) => setLocalFiles(e.target.checked)} />
              Allow local file access for Agent workflows (recommended for development machines)
            </label>

            {error ? <div style={{ color: '#f87171', fontSize: 13, marginTop: 12 }}>{error}</div> : null}

            <button
              type="submit"
              disabled={submitting}
              style={{
                marginTop: 24,
                padding: '12px 24px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--solar-cyan)',
                color: '#00212b',
                fontWeight: 600,
                cursor: submitting ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {submitting ? 'Saving…' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // intake
  return (
    <div style={shell}>
      <div style={card}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: 'var(--solar-cyan)', marginBottom: 12 }}>INTAKE</div>
        <h1 style={{ fontWeight: 400, fontFamily: 'Georgia, serif', margin: '0 0 8px', color: '#e8f4f8' }}>Welcome{intakeUser?.name ? `, ${intakeUser.name}` : ''}</h1>
        {intakeUser?.email ? (
          <p style={{ margin: '0 0 24px', fontSize: 13, color: 'rgba(160,190,200,0.85)' }}>{intakeUser.email}</p>
        ) : null}

        {loading ? <p style={{ color: 'rgba(180,200,210,0.9)' }}>Validating link…</p> : null}
        {error && step === 'intake' ? <p style={{ color: '#f87171' }}>{error}</p> : null}

        {!loading && !error && intakeUser && (
          <form onSubmit={onSubmitIntake}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--solar-cyan)', marginBottom: 10 }}>Skill level</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                {(['beginner', 'intermediate', 'advanced', 'expert'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSkill(s)}
                    style={{
                      padding: '14px 12px',
                      borderRadius: 8,
                      border: skill === s ? '1px solid var(--solar-cyan)' : '1px solid var(--border-subtle)',
                      background: skill === s ? 'rgba(45,212,191,0.12)' : 'rgba(0,26,34,0.45)',
                      color: skill === s ? 'var(--solar-cyan)' : 'rgba(200,220,230,0.92)',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                      fontFamily: 'inherit',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <TagInput label="CURRENT STACK" value={currentStack} onChange={setCurrentStack} />
            <TagInput label="FAVORITE TOOLS" value={favoriteTools} onChange={setFavoriteTools} suggestions={SUGGEST_TOOLS} />
            <TagInput label="FAVORITE AI" value={favoriteAi} onChange={setFavoriteAi} suggestions={SUGGEST_AI} />
            <TagInput label="FAVORITE PLATFORMS" value={favoritePlatforms} onChange={setFavoritePlatforms} suggestions={SUGGEST_PLATFORMS} />

            <label style={labelStyle}>Aspirations</label>
            <textarea value={aspirations} onChange={(e) => setAspirations(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />

            <TagInput label="GOALS" value={goals} onChange={setGoals} />

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--solar-cyan)', marginBottom: 8 }}>Published work (up to 5)</div>
              {published.map((p, i) => (
                <div key={i} style={{ marginBottom: 10, padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
                  <input placeholder="Title" value={p.title} onChange={(e) => {
                    const n = [...published];
                    n[i] = { ...n[i], title: e.target.value };
                    setPublished(n);
                  }} style={{ ...inputStyle, marginBottom: 6 }} />
                  <input placeholder="URL" value={p.url} onChange={(e) => {
                    const n = [...published];
                    n[i] = { ...n[i], url: e.target.value };
                    setPublished(n);
                  }} style={{ ...inputStyle, marginBottom: 6 }} />
                  <input placeholder="Description" value={p.description} onChange={(e) => {
                    const n = [...published];
                    n[i] = { ...n[i], description: e.target.value };
                    setPublished(n);
                  }} style={inputStyle} />
                </div>
              ))}
              {published.length < 5 && (
                <button
                  type="button"
                  onClick={() => setPublished([...published, { title: '', url: '', description: '' }])}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px dashed var(--border-subtle)',
                    background: 'transparent',
                    color: 'var(--solar-cyan)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  + Add work
                </button>
              )}
            </div>

            <label style={labelStyle}>GitHub username</label>
            <input value={githubUsername} onChange={(e) => setGithubUsername(e.target.value)} style={inputStyle} />

            <label style={labelStyle}>Portfolio URL</label>
            <input value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} style={inputStyle} />

            <label style={labelStyle}>Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={inputStyle}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={submitting}
              style={{
                marginTop: 24,
                padding: '12px 28px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--solar-cyan)',
                color: '#00212b',
                fontWeight: 600,
                cursor: submitting ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {submitting ? 'Submitting…' : 'Submit intake'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  letterSpacing: 2,
  color: 'var(--solar-cyan)',
  marginBottom: 6,
  marginTop: 12,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  background: 'rgba(0,26,34,0.6)',
  color: 'inherit',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
