import React, { useState, useEffect } from 'react';
import { IAMUser } from './sdk/types';
import { createIdentityClient, DEMO_IAM_USER } from './sdk/identity';
import { AuthScreen } from './components/auth/AuthScreen';
import { WorkbenchApp } from './components/WorkbenchApp';

export const App: React.FC = () => {
  const [user, setUser] = useState<IAMUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const identity = createIdentityClient();

  useEffect(() => {
    let isMounted = true;
    identity.getCurrentUser().then(activeUser => {
      if (isMounted) {
        setUser(activeUser || DEMO_IAM_USER);
        setAuthChecking(false);
      }
    }).catch(() => {
      if (isMounted) {
        setUser(DEMO_IAM_USER);
        setAuthChecking(false);
      }
    });
    return () => { isMounted = false; };
  }, []);

  const handleAuthenticated = (authenticatedUser: IAMUser) => {
    setUser(authenticatedUser);
  };

  const handleLogout = async () => {
    await identity.logout();
    setUser(null);
  };

  if (authChecking) {
    return (
      <div className="h-screen w-screen bg-[#0a0c10] flex flex-col items-center justify-center text-zinc-400 font-sans">
        <span className="material-symbols-outlined text-3xl animate-spin text-sky-400 mb-3">
          progress_activity
        </span>
        <p className="text-xs font-medium tracking-wide">Validating Agent Sam IAM session token...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <WorkbenchApp
      user={user}
      onLogout={handleLogout}
    />
  );
};

export default App;
