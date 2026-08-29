import React, { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function AuthSignUpPage() {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const next = params.get('next') || '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const emailOk = isEmail(email.trim().toLowerCase());
  const pwOk = password.length >= 8;
  const matchOk = password === confirm && confirm.length > 0;
  const canSubmit = name.trim().length > 0 && emailOk && pwOk && matchOk && !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setDoneMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Signup failed');
        return;
      }
      setDoneMsg('Account created. Check your email to verify your account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-app)',
    }}>
      <div style={{
        width: 380, padding: 32,
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
      }}>
        <div style={{
          color: 'var(--solar-cyan)', fontSize: 16, fontWeight: 500,
          fontFamily: 'var(--font-mono)', marginBottom: 24,
        }}>
          Inner Animal Media
        </div>

        {doneMsg && (
          <div style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 6,
            border: '1px solid rgba(45,212,191,0.35)',
            background: 'rgba(45,212,191,0.10)',
            color: 'rgba(200,255,245,0.95)',
            fontSize: 12,
          }}>
            {doneMsg}
          </div>
        )}

        {error && (
          <div style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 6,
            border: '1px solid rgba(248,113,113,0.35)',
            background: 'rgba(248,113,113,0.08)',
            color: 'rgba(254,226,226,0.95)',
            fontSize: 12,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
            autoComplete="name"
            placeholder="Your name"
            style={{
              width: '100%', marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              color: 'var(--text-main)',
            }}
          />

          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Email
          </label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            style={{
              width: '100%', marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              color: 'var(--text-main)',
            }}
          />
          {!emailOk && email.trim().length > 0 && (
            <div style={{ marginTop: -8, marginBottom: 10, fontSize: 12, color: 'rgba(248,113,113,0.9)' }}>
              Enter a valid email.
            </div>
          )}

          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Password
          </label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            style={{
              width: '100%', marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              color: 'var(--text-main)',
            }}
          />
          {!pwOk && password.length > 0 && (
            <div style={{ marginTop: -8, marginBottom: 10, fontSize: 12, color: 'rgba(248,113,113,0.9)' }}>
              Password must be at least 8 characters.
            </div>
          )}

          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Confirm password
          </label>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="Repeat password"
            style={{
              width: '100%', marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              color: 'var(--text-main)',
            }}
          />
          {confirm.length > 0 && !matchOk && (
            <div style={{ marginTop: -10, marginBottom: 12, fontSize: 12, color: 'rgba(248,113,113,0.9)' }}>
              Passwords do not match.
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid rgba(45,212,191,0.55)',
              background: 'rgba(45,212,191,0.12)',
              color: 'var(--text-main)',
              cursor: canSubmit ? 'pointer' : 'default',
              fontWeight: 500,
            }}
          >
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          <a
            href={next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login'}
            style={{ color: 'var(--solar-cyan)', textDecoration: 'none' }}
          >
            Already have an account? Sign in
          </a>
        </div>
      </div>
    </div>
  );
}

