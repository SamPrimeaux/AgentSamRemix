/**
 * DatabasePage — /dashboard/database and /dashboard/database/:databaseName
 *
 * Overview (default): database observability metrics via DatabasesTab.
 * Studio: lazy-mounted SQL explorer (DatabaseStudio).
 */

import React, { Suspense, lazy, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useWorkspace } from '../src/context/WorkspaceContext';
import {
  databaseStudioPathFromName,
  expectedDatabaseNameForWorkspace,
  isLegacyDatabaseStudioSearch,
  isPlatformWorkspace,
  PLATFORM_DATABASE_STUDIO_PATH,
} from '../src/lib/databaseStudioRoute';
import DatabasesTab from './analytics/tabs/DatabasesTab';

const DatabaseStudio = lazy(() =>
  import('./DatabaseStudio').then((m) => ({ default: m.DatabaseStudio })),
);

function DatabaseStudioFallback() {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center gap-2 text-[12px] text-muted">
      <Loader2 size={16} className="animate-spin" />
      Loading Database Studio…
    </div>
  );
}

export const DatabasePage: React.FC = () => {
  const { databaseName: routeDatabaseName } = useParams<{ databaseName?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { workspaceId, workspaces } = useWorkspace();
  const activeWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;
  const expectedStudioName = expectedDatabaseNameForWorkspace(activeWorkspace);
  const databaseName = routeDatabaseName?.trim() || undefined;
  const legacyStudio = !databaseName && isLegacyDatabaseStudioSearch(searchParams);
  const explicitAccountD1 =
    searchParams.get('source') === 'd1' &&
    (searchParams.get('resource_scope') === 'connected' ||
      searchParams.get('resource_scope') === 'platform') &&
    Boolean(searchParams.get('resource_ref')?.trim());

  const effectiveDatabaseName = React.useMemo(() => {
    // Account D1 switcher uses query resource_ref; do not force workspace slug.
    if (explicitAccountD1) return undefined;
    if (expectedStudioName) {
      if (!databaseName || databaseName.toLowerCase() !== expectedStudioName.toLowerCase()) {
        return expectedStudioName;
      }
    }
    return databaseName;
  }, [activeWorkspace, databaseName, expectedStudioName, explicitAccountD1]);

  useEffect(() => {
    // Guard against acting on an incomplete workspace list mid-load -- avoid a
    // false redirect-away flicker while `workspaces` is still populating.
    if (!workspaceId || workspaces.length === 0) return;
    if (explicitAccountD1) return;

    if (expectedStudioName && databaseName) {
      if (databaseName.toLowerCase() !== expectedStudioName.toLowerCase()) {
        navigate(databaseStudioPathFromName(expectedStudioName), { replace: true });
      }
      return;
    }

    // Platform workspace: collab slugs in the URL are stale — stay in studio, not analytics.
    if (databaseName && isPlatformWorkspace(activeWorkspace)) {
      if (legacyStudio) return;
      navigate(PLATFORM_DATABASE_STUDIO_PATH, { replace: true });
    }
  }, [
    workspaceId,
    workspaces,
    activeWorkspace,
    databaseName,
    expectedStudioName,
    explicitAccountD1,
    legacyStudio,
    navigate,
  ]);

  useEffect(() => {
    if (databaseName || !legacyStudio || explicitAccountD1) return;
    // Platform uses env.DB — never rewrite ?studio=1 into a collab database slug.
    if (isPlatformWorkspace(activeWorkspace)) return;
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        const ws = workspaceId?.trim();
        if (ws) headers['X-IAM-Workspace-Id'] = ws;
        const res = await fetch('/api/d1/context', { credentials: 'same-origin', headers });
        const ctx = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const match = Array.isArray(ctx.databases)
          ? ctx.databases.find(
              (d: { workspace_id?: string }) =>
                String(d?.workspace_id || '').trim() === ws,
            )
          : null;
        const name =
          (match?.database_name && String(match.database_name).trim()) ||
          (typeof ctx.active_database_name === 'string' && ctx.active_database_name.trim()) ||
          '';
        if (name) {
          navigate(`/dashboard/database/${encodeURIComponent(name)}`, { replace: true });
        }
      } catch {
        /* keep legacy ?studio=1 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [databaseName, legacyStudio, explicitAccountD1, navigate, workspaceId, activeWorkspace]);

  const backToOverview = useCallback(() => {
    navigate('/dashboard/database', { replace: true });
    setSearchParams({}, { replace: true });
  }, [navigate, setSearchParams]);

  const onOverviewClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest('a[href^="/dashboard/database"]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      const url = new URL(href, window.location.origin);
      if (!url.pathname.startsWith('/dashboard/database')) return;
      event.preventDefault();
      const named = url.pathname.match(/^\/dashboard\/database\/([^/]+)/);
      if (named?.[1]) {
        navigate(`/dashboard/database/${decodeURIComponent(named[1])}`, { replace: false });
        return;
      }
      if (isLegacyDatabaseStudioSearch(url.searchParams) || url.searchParams.get('source')) {
        const next = Object.fromEntries(url.searchParams.entries());
        if (!next.studio) next.studio = '1';
        setSearchParams(next, { replace: true });
        navigate(`/dashboard/database?${new URLSearchParams(next).toString()}`, { replace: true });
        return;
      }
      navigate('/dashboard/database?studio=1', { replace: true });
    },
    [navigate, setSearchParams],
  );

  if (databaseName || legacyStudio || explicitAccountD1) {
    return (
      <Suspense fallback={<DatabaseStudioFallback />}>
        <DatabaseStudio databaseName={effectiveDatabaseName} onBackToOverview={backToOverview} />
      </Suspense>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-auto px-4 py-4 md:px-6 md:py-5"
      onClickCapture={onOverviewClickCapture}
    >
      <DatabasesTab />
    </div>
  );
};

export default DatabasePage;
