import React, { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Menu, Plus } from 'lucide-react';
import type { IAMUser } from '../../sdk/types';
import { AgentChat } from './AgentChat';
import { TerminalDrawer } from './TerminalDrawer';

interface Props { user: IAMUser; onLogout: () => void | Promise<void>; }
type RouteMode = 'home' | 'editor';

type LiveView = {
  ok?: boolean;
  active?: boolean;
  sessionId?: string;
  expiresInMs?: number;
  targets?: Array<{ targetId: string; url: string; pageUrl?: string; title?: string; type?: string }>;
  error?: string;
};

function currentMode(): RouteMode {
  return window.location.pathname.includes('/editor') ? 'editor' : 'home';
}

function go(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function newConversationSuffix(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

const navigation = [
  ['⌂', 'Home'], ['＋', 'New chat'], ['▢', 'Chats'], ['▣', 'Projects'], ['◇', 'Work'], ['▧', 'Media'],
] as const;

export const AgentShell: React.FC<Props> = ({ user, onLogout }) => {
  const [mode, setMode] = useState<RouteMode>(currentMode());
  const [mobileNav, setMobileNav] = useState(false);
  const [prompt, setPrompt] = useState<string>();
  const [conversationSuffix, setConversationSuffix] = useState('');

  React.useEffect(() => {
    const onPop = () => setMode(currentMode());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const agentName = useMemo(() => {
    const base = `user-${String(user.id || 'default').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 72)}`;
    return conversationSuffix ? `${base}-${conversationSuffix}` : base;
  }, [user.id, conversationSuffix]);

  const openHome = () => {
    go('/dashboard/agent');
    setMode('home');
    setMobileNav(false);
  };

  const openEditor = () => {
    go('/dashboard/agent/editor');
    setMode('editor');
    setMobileNav(false);
  };

  const startNewChat = () => {
    setConversationSuffix(newConversationSuffix());
    setPrompt(undefined);
    openHome();
  };

  return (
    <div className="as-shell">
      <header className="as-topbar">
        <button
          className="as-mobile-round-btn as-mobile-only"
          onClick={() => setMobileNav((value) => !value)}
          type="button"
          aria-label="Open navigation"
          aria-expanded={mobileNav}
        >
          <Menu size={22} strokeWidth={1.8} />
        </button>

        <div className="as-mobile-mode-switch as-mobile-only" role="tablist" aria-label="Agent Sam mobile mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'home'}
            className={mode === 'home' ? 'active' : ''}
            onClick={openHome}
          >
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'editor'}
            className={mode === 'editor' ? 'active' : ''}
            onClick={openEditor}
          >
            Work
          </button>
        </div>

        <button
          className="as-mobile-round-btn as-mobile-new-chat as-mobile-only"
          onClick={startNewChat}
          type="button"
          aria-label="Start a new chat"
        >
          <Plus size={23} strokeWidth={1.8} />
        </button>

        <button className="as-brand" onClick={openHome}><span className="as-brand-glyph">A</span><strong>Agent Sam</strong></button>
        <div className="as-repo-pill"><span>repo</span><span>AgentSamRemix</span><small>main</small></div>
        <div className="as-top-spacer" />
        <div className="as-runtime-pill"><i /> Think · Code Mode</div>
        <button className="as-avatar" title={user.email} onClick={() => void onLogout()}>{(user.name || user.email || 'S').slice(0, 1).toUpperCase()}</button>
      </header>

      <div className="as-body">
        {mobileNav && (
          <button
            type="button"
            className="as-sidebar-scrim as-mobile-only"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
        )}

        <aside className={`as-sidebar ${mobileNav ? 'as-sidebar-mobile-open' : ''}`}>
          <nav className="as-nav-primary">
            {navigation.map(([icon, label]) => {
              const action = label === 'Home'
                ? openHome
                : label === 'New chat'
                  ? startNewChat
                  : label === 'Work'
                    ? openEditor
                    : undefined;
              const active = (label === 'Home' && mode === 'home') || (label === 'Work' && mode === 'editor');
              return (
                <button key={label} className={active ? 'active' : ''} onClick={action} type="button">
                  <span>{icon}</span>{label}
                </button>
              );
            })}
          </nav>
          <div className="as-nav-label">Products</div>
          <nav className="as-nav-primary">
            <button className={mode === 'editor' ? 'active' : ''} onClick={openEditor}><span>‹/›</span>Code</button>
            <button className={`as-nav-child ${mode === 'home' ? 'active' : ''}`} onClick={openHome}>Agent</button>
            <button className="as-nav-child">Examples</button>
            <button className="as-nav-child">Workflows</button>
            <button className="as-nav-child">Database</button>
          </nav>
          <div className="as-sidebar-bottom">
            <div className="as-user-row"><span className="as-user-dot">{(user.name || 'S')[0]}</span><span>{user.name || user.email}</span></div>
          </div>
        </aside>

        {mode === 'home' ? (
          <main className="as-home as-mobile-chat-surface">
            <div className="as-home-center">
              <h1><span>✣</span> {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Late night'}, {user.name?.split(' ')[0] || 'Sam'}</h1>
              <div className="as-mode-chips">
                {['Code', 'Write', 'Create', 'Learn', 'Life stuff'].map((label) => <button key={label}>{label}</button>)}
              </div>
              <AgentChat key={agentName} agentName={agentName} initialPrompt={prompt} onPromptConsumed={() => setPrompt(undefined)} />
              <div className="as-home-actions">
                <button onClick={openEditor}>Open code workspace</button>
                <button onClick={() => setPrompt('Check terminal_status. Tell me which Local, VM, and Sandbox lanes are available, without executing anything.')}>Check runtime</button>
              </div>
            </div>
            <TerminalDrawer mobileDock />
          </main>
        ) : (
          <main className="as-editor-shell">
            <EditorWorkspace />
            <aside className="as-agent-pane">
              <div className="as-pane-title"><strong>AGENT SAM</strong><span>live</span></div>
              <AgentChat key={agentName} agentName={agentName} compact />
            </aside>
            <TerminalDrawer />
          </main>
        )}
      </div>
    </div>
  );
};

const starterFiles: Record<string, string> = {
  'README.md': `# AgentSamRemix\n\nSmall Cloudflare-native Agent Sam workbench.\n\nUse Agent Sam or the Terminal lanes for real repository work. Monaco remains a scratch surface until repo file APIs are attached.`,
  'agent.ts': `// Agent Sam is implemented server-side with @cloudflare/think.\n// terminal_exec has explicit local, remote, and sandbox lanes.\n`,
  'wrangler.jsonc': `{\n  "name": "agentsamremix",\n  "main": "app/backend/src/index.ts"\n}`,
};

type WorkTab = 'overview' | 'scratch' | 'browser';

type RuntimeHealth = {
  status?: string;
  agent?: string;
  codeMode?: boolean;
  browserRun?: boolean;
  execos?: boolean;
  sandbox?: boolean;
  sessionCache?: boolean;
};

type ExecStatus = {
  ok?: boolean;
  preferredLane?: string;
  lanes?: Record<string, { ok?: boolean; state?: string; connection?: { name?: string; platform?: string; defaultCwd?: string } | null }>;
};

const EditorWorkspace: React.FC = () => {
  const [file, setFile] = useState('README.md');
  const [contents, setContents] = useState(starterFiles);
  const [tab, setTab] = useState<WorkTab>('overview');
  return (
    <section className="as-workspace">
      <div className="as-workspace-toolbar">
        <div className="as-toolbar-tabs">
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Workspace</button>
          <button className={tab === 'scratch' ? 'active' : ''} onClick={() => setTab('scratch')}>Scratch</button>
          <button className={tab === 'browser' ? 'active' : ''} onClick={() => setTab('browser')}>Browser</button>
        </div>
        <span className="as-workspace-status"><i /> Live runtime</span>
      </div>
      {tab === 'overview' ? (
        <WorkOverview onOpenScratch={() => setTab('scratch')} onOpenBrowser={() => setTab('browser')} />
      ) : tab === 'scratch' ? (
        <div className="as-code-layout">
          <aside className="as-files">
            <div className="as-files-head">SCRATCH</div>
            {Object.keys(contents).map((name) => <button key={name} className={file === name ? 'active' : ''} onClick={() => setFile(name)}>{name}</button>)}
            <div className="as-files-note">Local scratch only — deliberately not presented as repository state. Real repo files are the next Work-surface integration.</div>
          </aside>
          <div className="as-monaco-wrap">
            <div className="as-editor-tab">{file}<span>scratch</span></div>
            <Editor
              theme="vs-dark"
              language={file.endsWith('.md') ? 'markdown' : file.endsWith('.jsonc') ? 'json' : 'typescript'}
              value={contents[file]}
              onChange={(value) => setContents((prev) => ({ ...prev, [file]: value || '' }))}
              options={{ minimap: { enabled: true }, fontSize: 14, wordWrap: 'on', padding: { top: 16 }, automaticLayout: true }}
            />
          </div>
        </div>
      ) : <LiveBrowserPane />}
    </section>
  );
};

const WorkOverview: React.FC<{ onOpenScratch: () => void; onOpenBrowser: () => void }> = ({ onOpenScratch, onOpenBrowser }) => {
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [exec, setExec] = useState<ExecStatus | null>(null);

  React.useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/health', { credentials: 'same-origin' }).then((response) => response.json()).catch(() => null),
      fetch('/api/exec/status', { credentials: 'same-origin' }).then((response) => response.json()).catch(() => null),
    ]).then(([healthData, execData]) => {
      if (!active) return;
      setHealth(healthData as RuntimeHealth | null);
      setExec(execData as ExecStatus | null);
    });
    return () => { active = false; };
  }, []);

  const lanes = Object.entries(exec?.lanes || {});
  const readyCount = lanes.filter(([, value]) => value?.ok).length;

  return (
    <div className="as-work-overview">
      <div className="as-work-hero">
        <div>
          <span className="as-eyebrow">WORKSPACE</span>
          <h2>Build with Agent Sam</h2>
          <p>Chat stays conversational. Work holds the live execution context: repository, terminal, browser, files, diffs and approvals.</p>
        </div>
        <div className="as-work-hero-status"><i className={health?.status === 'ok' ? 'ready' : ''} />{health?.status === 'ok' ? 'Runtime ready' : 'Checking runtime'}</div>
      </div>

      <div className="as-work-card-grid">
        <button className="as-work-card" type="button" onClick={onOpenScratch}>
          <span className="as-work-card-icon">‹/›</span>
          <strong>Code workspace</strong>
          <p>Monaco is available as scratch today. The real repository filesystem will replace the scratch adapter rather than pretending demo files are live.</p>
          <small>Open scratch</small>
        </button>
        <button className="as-work-card" type="button" onClick={onOpenBrowser}>
          <span className="as-work-card-icon">◎</span>
          <strong>Browser Run</strong>
          <p>{health?.browserRun ? 'Cloudflare Browser Run is bound and ready for the Think agent.' : 'Checking Browser Run capability…'}</p>
          <small>Open browser</small>
        </button>
        <div className="as-work-card">
          <span className="as-work-card-icon">›_</span>
          <strong>Execution lanes</strong>
          <p>{lanes.length ? `${readyCount} of ${lanes.length} registered lanes currently report ready.` : 'Loading Local, VM, Sandbox and Environment status…'}</p>
          <div className="as-work-lanes">
            {lanes.map(([name, value]) => <span key={name} className={value?.ok ? 'ready' : ''}><i />{name === 'remote' ? 'VM' : name}</span>)}
          </div>
        </div>
        <div className="as-work-card">
          <span className="as-work-card-icon">AS</span>
          <strong>Agent runtime</strong>
          <p>{health?.agent || 'Think'} · {health?.codeMode ? 'Code Mode active' : 'Code Mode checking'} · {health?.execos ? 'ExecOS connected' : 'ExecOS checking'}</p>
          <small>Server-authoritative tool activity renders in the Agent pane</small>
        </div>
      </div>

      <div className="as-work-next">
        <strong>Next product slice</strong>
        <span>Replace scratch with the selected repository's real tree/file/diff APIs, then keep this exact shell.</span>
      </div>
    </div>
  );
};

const LiveBrowserPane: React.FC = () => {
  const [state, setState] = useState<LiveView | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch('/api/browser/live-view', { credentials: 'same-origin' });
      const data = await response.json().catch(() => ({})) as LiveView;
      setState(data);
    } catch (error) {
      setState({ ok: false, active: false, error: error instanceof Error ? error.message : 'browser_live_view_failed' });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function close() {
    await fetch('/api/browser/live-view', { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
    await refresh();
  }

  const target = state?.targets?.find((item) => item.type === 'page') || state?.targets?.[0];
  if (target?.url) {
    return (
      <div className="as-live-browser">
        <div className="as-live-browser-bar">
          <span className="as-live-dot" />
          <span className="as-live-url">{target.pageUrl || target.title || 'Browser Run'}</span>
          <button onClick={() => void refresh()}>Refresh</button>
          <button onClick={() => void close()}>Close session</button>
        </div>
        <iframe title="Agent Sam Browser Run Live View" src={target.url} allow="clipboard-read; clipboard-write" />
      </div>
    );
  }

  return (
    <div className="as-browser-agent">
      <div className="as-browser-icon">◎</div>
      <h2>{loading ? 'Checking Browser Run…' : 'Browser Run ready'}</h2>
      <p>Ask Agent Sam to navigate or inspect a site. Its reusable Browser Run session will appear here automatically as a real interactive Live View.</p>
      <p className="as-browser-note">Agent policy: WebMCP first when available, then CDP/DOM. The browser session is persisted by the same Think Agent that owns the conversation.</p>
      {state?.error && <p className="as-browser-error">{state.error}</p>}
      <button className="as-browser-refresh" onClick={() => void refresh()}>Check now</button>
    </div>
  );
};
