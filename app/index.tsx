import './index.css';
import './src/seti-icons.css';
import './src/monaco-diff.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { bootstrapSupabaseFromSession, setSupabaseBootstrap } from './src/lib/supabase';
import {
  ensureDashboardBootstrapBeforeMount,
  isDashboardBootstrapPath,
  readDashboardBootstrapCache,
} from './src/loadDashboardBootstrap';
import { installAuthSessionFetchGuard } from './src/pwa/authSessionState';
import { SessionExpiredGate } from './src/pwa/SessionExpiredGate';
import { isPhoneViewport } from './lib/breakpoints';

installAuthSessionFetchGuard();

async function mountDashboard() {
  if (isDashboardBootstrapPath()) {
    await ensureDashboardBootstrapBeforeMount();
  }

  const bootClient = readDashboardBootstrapCache(60_000)?.client;
  if (bootClient?.supabaseUrl && bootClient?.supabaseAnonKey) {
    setSupabaseBootstrap(bootClient.supabaseUrl, bootClient.supabaseAnonKey);
  }

  void bootstrapSupabaseFromSession();

  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Could not find root element to mount to');

  const bootUser = readDashboardBootstrapCache(60_000)?.me?.user?.id;
  if (isDashboardBootstrapPath() && !bootUser && isPhoneViewport()) {
    try {
      const probe = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (probe.status === 401) {
        type DashboardRoot = ReturnType<typeof ReactDOM.createRoot>;
        const w = window as Window & { __IAM_DASHBOARD_ROOT__?: DashboardRoot };
        if (!w.__IAM_DASHBOARD_ROOT__) {
          w.__IAM_DASHBOARD_ROOT__ = ReactDOM.createRoot(rootElement);
        }
        w.__IAM_DASHBOARD_ROOT__.render(
          <React.StrictMode>
            <SessionExpiredGate forced />
          </React.StrictMode>,
        );
        const recovery = document.getElementById('iam-boot-recovery');
        if (recovery) recovery.hidden = true;
        try {
          (window as Window & { __IAM_MARK_DASHBOARD_MOUNTED__?: () => void }).__IAM_MARK_DASHBOARD_MOUNTED__?.();
        } catch {
          /* ignore */
        }
        return;
      }
    } catch {
      /* mount full app */
    }
  }

  type DashboardRoot = ReturnType<typeof ReactDOM.createRoot>;
  const w = window as Window & { __IAM_DASHBOARD_ROOT__?: DashboardRoot };
  if (!w.__IAM_DASHBOARD_ROOT__) {
    w.__IAM_DASHBOARD_ROOT__ = ReactDOM.createRoot(rootElement);
  }
  w.__IAM_DASHBOARD_ROOT__.render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );

  const recovery = document.getElementById('iam-boot-recovery');
  if (recovery) recovery.hidden = true;
  try {
    (window as Window & { __IAM_MARK_DASHBOARD_MOUNTED__?: () => void }).__IAM_MARK_DASHBOARD_MOUNTED__?.();
  } catch {
    /* ignore */
  }
}

void mountDashboard();
