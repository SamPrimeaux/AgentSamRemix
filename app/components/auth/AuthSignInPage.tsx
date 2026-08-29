import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function AuthSignInPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verified = params.get('verified') === '1';
  const reset = params.get('reset') === '1';
  const next = params.get('next') || '';

  const oauthReturn = useMemo(() => {
    const n = next.trim();
    if (
      n &&
      n.startsWith('/') &&
      !n.startsWith('//') &&
      n.startsWith('/dashboard') &&
      !n.startsWith('/dashboard/settings/integrations')
    ) {
      return n;
    }
    return '/dashboard/overview';
  }, [next]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, next: next || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Login failed');
        return;
      }
      const redirect = typeof data.redirect === 'string' && data.redirect.startsWith('/')
        ? data.redirect
        : '/dashboard/overview';
      navigate(redirect, { replace: true });
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

        {verified && (
          <div style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 6,
            border: '1px solid rgba(45,212,191,0.35)',
            background: 'rgba(45,212,191,0.10)',
            color: 'rgba(200,255,245,0.95)',
            fontSize: 12,
          }}>
            Email verified — you can now sign in.
          </div>
        )}
        {reset && (
          <div style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 6,
            border: '1px solid rgba(45,212,191,0.35)',
            background: 'rgba(45,212,191,0.10)',
            color: 'rgba(200,255,245,0.95)',
            fontSize: 12,
          }}>
            Password updated — please sign in.
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

        <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a
            href={`/api/oauth/google/start?login=1&return_to=${encodeURIComponent(oauthReturn)}`}
            className="block w-full text-center no-underline"
            style={{
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.2)',
              background: '#ffffff',
              color: '#1e293b',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Continue with Google
          </a>
          <a
            href={`/api/oauth/github/start?login=1&next=${encodeURIComponent(oauthReturn)}`}
            className="block w-full text-center no-underline"
            style={{
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              color: 'var(--text-main)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Continue with GitHub
          </a>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          Or sign in with email and password
        </p>

        <form onSubmit={onSubmit}>
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
              width: '100%', marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              color: 'var(--text-main)',
            }}
          />

          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Password
          </label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            style={{
              width: '100%', marginBottom: 18,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              color: 'var(--text-main)',
            }}
          />

          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid rgba(45,212,191,0.55)',
              background: 'rgba(45,212,191,0.12)',
              color: 'var(--text-main)',
              cursor: submitting ? 'default' : 'pointer',
              fontWeight: 500,
            }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          <a href="/forgot-password" style={{ color: 'var(--solar-cyan)', textDecoration: 'none' }}>
            Forgot password?
          </a>
          <span style={{ margin: '0 10px', opacity: 0.5 }}>|</span>
          <a href="/signup" style={{ color: 'var(--solar-cyan)', textDecoration: 'none' }}>
            Create account
          </a>
        </div>
      </div>
    </div>
  );
}

