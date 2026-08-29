import React, { useEffect, useMemo, useState } from 'react';
import type { IAMUser } from './sdk/types';
import { createIdentityClient, DEMO_IAM_USER } from './sdk/identity';
import { AuthScreen } from './components/auth/AuthScreen';
import { AgentShell } from './components/agent/AgentShell';

export const App: React.FC = () => {
  const [user, setUser] = useState<IAMUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const identity = useMemo(() => createIdentityClient(), []);

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

  if (authChecking) {
    return <div className="as-auth-check"><span>Agent Sam</span><small>Validating IAM session…</small></div>;
  }

  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  return <AgentShell user={user} onLogout={handleLogout} />;
};

export default App;
