import React from 'react';

type Connector = {
  id: string;
  title: string;
  subtitle: string;
  health: 'ready' | 'workspace' | 'tool' | 'approval' | 'dev' | 'qa';
  steps: { label: string; value: string }[];
};

const CONNECTORS: Connector[] = [
  {
    id: 'cloudflare',
    title: 'Cloudflare Stack',
    subtitle: 'D1, R2, Workers, Vectorize, Queues',
    health: 'ready',
    steps: [
      { label: 'Auth', value: 'Env vars' },
      { label: 'Tables', value: 'D1 truth' },
      { label: 'Use', value: 'DB + files' },
    ],
  },
  {
    id: 'supabase',
    title: 'Supabase',
    subtitle: 'Postgres, pgvector, auth, observability mirrors',
    health: 'workspace',
    steps: [
      { label: 'Auth', value: 'Vault key' },
      { label: 'Mode', value: 'Read first' },
      { label: 'Use', value: 'RAG + logs' },
    ],
  },
  {
    id: 'resend',
    title: 'Resend',
    subtitle: 'Transactional email for workflow reports and alerts',
    health: 'tool',
    steps: [
      { label: 'Auth', value: 'API key' },
      { label: 'Safety', value: 'Approval' },
      { label: 'Use', value: 'Send mail' },
    ],
  },
  {
    id: 'gmail',
    title: 'Gmail MCP',
    subtitle: 'Read, draft, send, and thread workflow email actions',
    health: 'approval',
    steps: [
      { label: 'Auth', value: 'OAuth' },
      { label: 'Scope', value: 'Least needed' },
      { label: 'Use', value: 'Email tasks' },
    ],
  },
  {
    id: 'github',
    title: 'GitHub',
    subtitle: 'Repos, issues, pull requests, code workflow handoff',
    health: 'dev',
    steps: [
      { label: 'Auth', value: 'Token/app' },
      { label: 'Safety', value: 'PR first' },
      { label: 'Use', value: 'Code ops' },
    ],
  },
  {
    id: 'browser',
    title: 'Browser Tools',
    subtitle: 'Screenshots, visual QA, page checks, click flows',
    health: 'qa',
    steps: [
      { label: 'Auth', value: 'Session' },
      { label: 'Mode', value: 'Read/click' },
      { label: 'Use', value: 'Visual tests' },
    ],
  },
];

type Props = {
  onToast: (msg: string) => void;
};

export function WorkflowConnectionsView({ onToast }: Props) {
  return (
    <div className="wf-drawer-body" style={{ padding: 12 }}>
      <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
        <button
          type="button"
          className="wf-btn primary"
          onClick={() => onToast('Connection setup routes through workspace API key vault (coming soon).')}
        >
          Add connection
        </button>
        <button
          type="button"
          className="wf-btn"
          onClick={() => onToast('Safe connection tests will call scoped health endpoints — no secrets shown.')}
        >
          Test all
        </button>
      </div>
      {CONNECTORS.map((c) => (
        <div key={c.id} className="wf-card" style={{ marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: 8, alignItems: 'center' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                background: 'var(--wf-accent-soft)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--wf-accent)',
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 900 }}>{c.title.slice(0, 2).toUpperCase()}</span>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800 }}>{c.title}</div>
              <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--wf-muted)' }}>{c.subtitle}</p>
            </div>
            <span className="wf-tag">{c.health}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, marginTop: 8 }}>
            {c.steps.map((s) => (
              <div key={s.label} className="wf-card" style={{ padding: 6 }}>
                <span style={{ fontSize: 8, color: 'var(--wf-muted)', fontFamily: 'var(--wf-font-mono)' }}>{s.label}</span>
                <strong style={{ display: 'block', fontSize: 10, marginTop: 2 }}>{s.value}</strong>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            <button
              type="button"
              className="wf-btn"
              onClick={() => onToast(`Connect ${c.title} via Settings → Integrations (secret presence only).`)}
            >
              Connect
            </button>
            <button
              type="button"
              className="wf-btn"
              onClick={() => onToast(`Test ${c.title}: health check pending vault binding.`)}
            >
              Test
            </button>
          </div>
        </div>
      ))}
      <div className="wf-empty" style={{ marginTop: 8 }}>
        Never expose raw secrets in the canvas. Connection setup should route through the existing settings / API key vault pattern.
      </div>
    </div>
  );
}
