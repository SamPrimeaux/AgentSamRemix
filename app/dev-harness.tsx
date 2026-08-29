import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AgentHome } from '../dashboard/components/agent/AgentHome';
import { DashboardSidebar } from '../dashboard/components/shell/DashboardSidebar';

/**
 * Peel 2: DashboardSidebar (real shell nav) + AgentHome, side by side.
 * No AppShellFrame yet — that needs the full top-level state container.
 * Every callback here is a stub/no-op — visual QA only.
 */
function Harness() {
  const [expanded, setExpanded] = React.useState(true);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#06070a' }}>
      <DashboardSidebar
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
        onItemActivate={() => {}}
        onNewChat={() => console.log('[harness] onNewChat')}
        onOpenChats={() => console.log('[harness] onOpenChats')}
        onOpenMovieMode={() => console.log('[harness] onOpenMovieMode')}
        onSelectChat={(id, title) => console.log('[harness] onSelectChat', id, title)}
        onDeleteActiveChat={(id) => console.log('[harness] onDeleteActiveChat', id)}
        activeConversationId={null}
        workspaceLabel="AgentSamRemix"
        avatarInitial="S"
        avatarUrl={null}
        workspaceSubtitle="main"
      />
      <div style={{ flex: 1, overflow: 'auto' }}>
        <AgentHome
          displayName="Sam"
          showHero
          terminalDocked={false}
          onModeSelect={(mode) => console.log('[harness] onModeSelect', mode)}
          onComposerHost={() => {}}
          onMessagesHost={() => {}}
        />
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Harness />
    </BrowserRouter>
  </React.StrictMode>
);
