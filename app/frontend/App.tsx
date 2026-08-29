import React, { useEffect, useMemo, useState } from 'react';
import type { IAMUser } from './sdk/types';
import { createIdentityClient, DEMO_IAM_USER } from './sdk/identity';
import { AuthScreen } from './components/auth/AuthScreen';
import { AgentShell } from './components/agent/AgentShell';
import { SettingsWorkspace, type SettingsSection } from './components/settings/SettingsWorkspace';

export const App: React.FC = () => {
  const [user, setUser] = useState<IAMUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const identity = useMemo(() => createIdentityClient(), []);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let mounted = true;
    const localDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    identity.getCurrentUser()
      .then((activeUser) => {
        if (!mounted) return;
        setUser(activeUser || (localDev ? DEMO_IAM_USER : null));
        setAuthChecking(false);
      })
      .catch(() => {
        if (!mounted) return;
        setUser(localDev ? DEMO_IAM_USER : null);
        setAuthChecking(false);
      });
    return () => { mounted = false; };
  }, [identity]);

  async function handleLogout() {
    await identity.logout();
    setUser(null);
  }

  const go = (path: string) => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };

  if (authChecking) {
    return <div className="as-auth-check"><span>Agent Sam</span><small>Validating IAM session…</small></div>;
  }

  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  if (pathname.startsWith('/dashboard/settings')) {
    const section: SettingsSection = pathname.includes('/indexrules') ? 'indexrules' : 'keys';
    return (
      <SettingsWorkspace
        section={section}
        onNavigate={(next) => go(`/dashboard/settings/${next}`)}
        onClose={() => go('/dashboard/agent')}
      />
    );
  }

  return <AgentShell user={user} onLogout={handleLogout} />;
};

export default App;
