import React, { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { PublicAuthRoutes } from './components/shell/PublicAuthRoutes';

/**
 * Keep the document entrypoint intentionally boring:
 * public auth routes do not mount the dashboard runtime or its providers.
 */
const DashboardApp = lazy(() => import('./app/DashboardApp'));

const App: React.FC = () => {
  const { pathname } = useLocation();

  if (!pathname.startsWith('/dashboard')) {
    return <PublicAuthRoutes />;
  }

  return (
    <Suspense
      fallback={
        <div
          role="status"
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--bg-app)',
            color: 'var(--text-muted)',
          }}
        >
          Loading workspace…
        </div>
      }
    >
      <DashboardApp />
    </Suspense>
  );
};

export default App;
