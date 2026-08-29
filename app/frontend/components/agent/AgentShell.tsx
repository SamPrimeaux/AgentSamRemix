import React, { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { IAMUser } from '../../sdk/types';
import { AgentChat } from './AgentChat';
import { TerminalDrawer } from './TerminalDrawer';

interface Props { user: IAMUser; onLogout: () => void | Promise<void>; }

type RouteMode = 'home' | 'editor';

function currentMode(): RouteMode {
  return window.location.pathname.includes('/editor') ? 'editor' : 'home';
}

function go(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const navigation = [
  ['⌂', 'Home'], ['＋', 'New chat'], ['▢', 'Chats'], ['▣', 'Projects'], ['◇', 'Work'], ['▧', 'Media'],
] as const;

export const AgentShell: React.FC<Props> = ({ user, onLogout }) => {
  const [mode, setMode] = useState<RouteMode>(currentMode());
  const [mobileNav, setMobileNav] = useState(false);
  const [prompt, setPrompt] = useState<string>();

  React.useEffect(() => {
    const onPop = () => setMode(currentMode());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const agentName = useMemo(() => `user-${String(user.id || 'default').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)}`, [user.id]);

  const openHome = () => { go('/dashboard/agent'); setMode('home'); };
  const openEditor = () => { go('/dashboard/agent/editor'); setMode('editor'); };

  return (
    <div className="as-shell">
      <header className="as-topbar">
        <button className="as-icon-btn as-mobile-only" onClick={() => setMobileNav((v) => !v)}>☰</button>
        <button className="as-brand" onClick={openHome}><span className="as-brand-glyph">A</span><strong>Agent Sam</strong></button>
        <div className="as-repo-pill"><span>⌁</span><span>AgentSamRemix</span><small>main</small></div>
        <div className="as-top-spacer" />
        <div className="as-runtime-pill"><i /> Think · Code Mode</div>
        <button className="as-avatar" title={user.email} onClick={() => void onLogout()}>{(user.name || user.email || 'S').slice(0, 1).toUpperCase()}</button>
      </header>

      <div className="as-body">
        <aside className={`as-sidebar ${mobileNav ? 'as-sidebar-mobile-open' : ''}`}>
          <nav className="as-nav-primary">
            {navigation.map(([icon, label], idx) => (
              <button key={label} className={idx === 0 && mode === 'home' ? 'active' : ''} onClick={idx === 0 ? openHome : undefined}>
                <span>{icon}</span>{label}
              </button>
            ))}
          </nav>
          <div className="as-nav-label">Products</div>
          <nav className="as-nav-primary">
            <button className={mode === 'editor' ? 'active' : ''} onClick={openEditor}><span>‹/›</span>Code</button>
            <button className="as-nav-child active" onClick={openHome}>Agent</button>
            <button className="as-nav-child">Examples</button>
            <button className="as-nav-child">Workflows</button>
            <button className="as-nav-child">Database</button>
          </nav>
          <div className="as-sidebar-bottom">
            <div className="as-user-row"><span className="as-user-dot">{(user.name || 'S')[0]}</span><span>{user.name || user.email}</span></div>
          </div>
        </aside>

        {mode === 'home' ? (
          <main className="as-home">
            <div className="as-home-center">
              <h1><span>✣</span> {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Late night'}, {user.name?.split(' ')[0] || 'Sam'}</h1>
              <div className="as-mode-chips">
                {['Code', 'Write', 'Create', 'Learn', 'Life stuff'].map((label) => <button key={label}>{label}</button>)}
              </div>
              <AgentChat agentName={agentName} initialPrompt={prompt} onPromptConsumed={() => setPrompt(undefined)} />
              <div className="as-home-actions">
                <button onClick={openEditor}>Open code workspace</button>
                <button onClick={() => setPrompt('Check the ExecOS host status, then tell me what real work you can do from this app.')}>Test real runtime</button>
              </div>
            </div>
          </main>
        ) : (
          <main className="as-editor-shell">
            <EditorWorkspace />
            <aside className="as-agent-pane">
              <div className="as-pane-title"><strong>AGENT SAM</strong><span>live</span></div>
              <AgentChat agentName={agentName} compact />
            </aside>
            <TerminalDrawer />
          </main>
        )}
      </div>
    </div>
  );
};

const starterFiles: Record<string, string> = {
  'README.md': `# AgentSamRemix\n\nSmall Cloudflare-native Agent Sam workbench.\n\nThe editor is a local scratch surface; Agent Sam and the terminal execute against the real runtime.`,
  'agent.ts': `// Agent Sam is implemented server-side with @cloudflare/think.\n// Ask the agent to inspect the real repo via host_exec.\n`,
  'wrangler.jsonc': `{\n  "name": "agentsamremix",\n  "main": "app/backend/src/index.ts"\n}`,
};

const EditorWorkspace: React.FC = () => {
  const [file, setFile] = useState('README.md');
  const [contents, setContents] = useState(starterFiles);
  const [tab, setTab] = useState<'code' | 'browser'>('code');
  return (
    <section className="as-workspace">
      <div className="as-workspace-toolbar">
        <div className="as-toolbar-tabs">
          <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}>Code</button>
          <button className={tab === 'browser' ? 'active' : ''} onClick={() => setTab('browser')}>Browser</button>
        </div>
        <span className="as-workspace-status"><i /> Cloudflare runtime</span>
      </div>
      {tab === 'code' ? (
        <div className="as-code-layout">
          <aside className="as-files">
            <div className="as-files-head">FILES</div>
            {Object.keys(contents).map((name) => <button key={name} className={file === name ? 'active' : ''} onClick={() => setFile(name)}>{name}</button>)}
            <div className="as-files-note">Scratch files only. Use Agent Sam or Terminal for the real repo.</div>
          </aside>
          <div className="as-monaco-wrap">
            <div className="as-editor-tab">{file}<span>×</span></div>
            <Editor
              theme="vs-dark"
              language={file.endsWith('.md') ? 'markdown' : file.endsWith('.jsonc') ? 'json' : 'typescript'}
              value={contents[file]}
              onChange={(value) => setContents((prev) => ({ ...prev, [file]: value || '' }))}
              options={{ minimap: { enabled: true }, fontSize: 13, wordWrap: 'on', padding: { top: 14 }, automaticLayout: true }}
            />
          </div>
        </div>
      ) : (
        <div className="as-browser-agent">
          <div className="as-browser-icon">◎</div>
          <h2>Agent-controlled Browser Run</h2>
          <p>Ask Agent Sam to navigate, inspect, test, or research. The real Think execute tool has CDP access through Cloudflare Browser Run.</p>
          <p className="as-browser-note">WebMCP-first policy is enabled in the agent prompt when the page/browser exposes WebMCP APIs; CDP is the fallback.</p>
        </div>
      )}
    </section>
  );
};
