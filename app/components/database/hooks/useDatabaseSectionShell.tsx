/**
 * Section-shell family for Database Studio: d1 vs platform_supabase vs connected_supabase.
 * Mechanical peel from DatabaseStudio.tsx (S1) — no SQL/results/drawer logic.
 */

import React, { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';

import {
  databaseTableDisplayLabel as tableDisplayLabel,
  findSelectedDatabaseTable as findSelectedTable,
  type DatabaseTableMeta,
} from '../../../src/lib/databaseStudioModels';
import type { DatabaseStudioDatasource, DatabaseStudioSection } from '../../../src/lib/databaseStudioRoute';
import { fetchDatabaseJson as fetchJson } from '../../../src/lib/databaseStudioApi';
import type {
  DatabaseD1Resource,
  DatabaseSupabaseProject,
  PlatformSupabaseResource,
} from './useDatabaseResources';

type Datasource = DatabaseStudioDatasource;

export function resolveDatabaseStudioActiveTables(opts: {
  studioSection: DatabaseStudioSection;
  isSuperadmin: boolean;
  tables: Record<Datasource, DatabaseTableMeta[]>;
  effectiveDatasource: Datasource;
}): DatabaseTableMeta[] {
  const { studioSection, isSuperadmin, tables, effectiveDatasource } = opts;
  return studioSection === 'connected_supabase'
    ? tables.supabase
    : !isSuperadmin && studioSection === 'd1'
      ? tables.d1
      : tables[effectiveDatasource];
}

export function resolveDatabaseStudioDatasourceLabel(opts: {
  effectiveDatasource: Datasource;
  studioSection: DatabaseStudioSection;
  selectedD1Resource: DatabaseD1Resource | undefined;
  d1ResourceName: string;
  databaseName?: string;
  platformSupabase: PlatformSupabaseResource | null;
  connectedSupabase: DatabaseSupabaseProject | undefined;
  supabaseProjectRef: string;
}): string {
  const {
    effectiveDatasource,
    studioSection,
    selectedD1Resource,
    d1ResourceName,
    databaseName,
    platformSupabase,
    connectedSupabase,
    supabaseProjectRef,
  } = opts;
  return effectiveDatasource === 'd1'
    ? `${selectedD1Resource?.database_name || d1ResourceName || databaseName?.trim() || 'Cloudflare D1'} · Cloudflare D1`
    : studioSection === 'platform_supabase'
      ? `${platformSupabase?.name || 'Supabase Postgres'} · Supabase Postgres`
      : connectedSupabase?.name
        ? `${connectedSupabase.name} · Supabase Postgres`
        : supabaseProjectRef
          ? `${supabaseProjectRef} · Supabase Postgres`
          : 'Supabase Postgres';
}

export function SetupCard({ title, body, to }: { title: string; body: string; to: string }) {
  const external = to.startsWith('/api/') || to.startsWith('http');
  const className =
    'mt-4 inline-flex rounded-lg bg-[var(--color-accent,var(--solar-cyan))]/15 px-3 py-2 text-[11px] font-bold text-[var(--color-accent,var(--solar-cyan))] no-underline hover:bg-[var(--color-accent,var(--solar-cyan))]/25';
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6 shadow-sm">
      <h3 className="text-sm font-semibold text-main">{title}</h3>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">{body}</p>
      {external ? (
        <a href={to} className={className}>
          Connect
        </a>
      ) : (
        <Link to={to} className={className}>
          Open
        </Link>
      )}
    </div>
  );
}

type UseDatabaseSectionShellInput = {
  studioSection: DatabaseStudioSection;
  setStudioSection: Dispatch<SetStateAction<DatabaseStudioSection>>;
  setSidebarSource: Dispatch<SetStateAction<DatabaseStudioDatasource>>;
  effectiveDatasource: Datasource;
  isSuperadmin: boolean;
  activeTables: DatabaseTableMeta[];
  tableSearch: string;
  pageReady: boolean;
  databaseName?: string;
  d1ResourceRef: string;
  d1Resources: DatabaseD1Resource[];
  setD1ResourceId: Dispatch<SetStateAction<string>>;
  setD1ResourceName: Dispatch<SetStateAction<string>>;
  clearD1Tables: () => void;
  clearSupabaseTables: () => void;
  loadTables: (target: Datasource) => Promise<void> | void;
  loadCustomerSupabaseTables: (projectRef: string) => Promise<void> | void;
  selectedD1Resource: DatabaseD1Resource | undefined;
  d1ResourceName: string;
  platformSupabase: PlatformSupabaseResource | null;
  connectedSupabase: DatabaseSupabaseProject | undefined;
  supabaseProjectRef: string;
  setSupabaseProjectRef: Dispatch<SetStateAction<string>>;
  setSelectedTable: Dispatch<SetStateAction<string | null>>;
  selectedTable: string | null;
  loadingTables: boolean;
  clearColumnCache: () => void;
  setExpandedTables: Dispatch<SetStateAction<Set<string>>>;
  datasource: Datasource;
  capLoaded: boolean;
  supabaseConnectUrl: string;
  supabaseConnected: boolean;
  workspaceId?: string | null;
};

export function useDatabaseSectionShell({
  studioSection,
  setStudioSection,
  setSidebarSource,
  effectiveDatasource,
  isSuperadmin,
  activeTables,
  tableSearch,
  pageReady,
  databaseName,
  d1ResourceRef,
  d1Resources,
  setD1ResourceId,
  setD1ResourceName,
  clearD1Tables,
  clearSupabaseTables,
  loadTables,
  loadCustomerSupabaseTables,
  selectedD1Resource,
  d1ResourceName,
  platformSupabase,
  connectedSupabase,
  supabaseProjectRef,
  setSupabaseProjectRef,
  setSelectedTable,
  selectedTable,
  loadingTables,
  clearColumnCache,
  setExpandedTables,
  datasource,
  capLoaded,
  supabaseConnectUrl,
  supabaseConnected,
  workspaceId,
}: UseDatabaseSectionShellInput) {
  const datasourceLabel = resolveDatabaseStudioDatasourceLabel({
    effectiveDatasource,
    studioSection,
    selectedD1Resource,
    d1ResourceName,
    databaseName,
    platformSupabase,
    connectedSupabase,
    supabaseProjectRef,
  });

  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return activeTables;
    return activeTables.filter((t) => {
      const label = tableDisplayLabel(t, effectiveDatasource).toLowerCase();
      return label.includes(q) || t.name.toLowerCase().includes(q);
    });
  }, [activeTables, effectiveDatasource, tableSearch]);

  useEffect(() => {
    if (!pageReady) return;
    if ((databaseName?.trim() || studioSection === 'd1') && d1ResourceRef) {
      void loadTables('d1');
      return;
    }
    if (studioSection === 'platform_supabase') {
      void loadTables('supabase');
      return;
    }
  }, [pageReady, databaseName, studioSection, d1ResourceRef, loadTables]);

  useEffect(() => {
    if (!pageReady || studioSection !== 'connected_supabase') return;
    if (!supabaseConnected || !supabaseProjectRef.trim()) return;
    void loadCustomerSupabaseTables(supabaseProjectRef);
  }, [
    pageReady,
    studioSection,
    supabaseConnected,
    supabaseProjectRef,
    loadCustomerSupabaseTables,
  ]);

  useEffect(() => {
    clearColumnCache();
    setExpandedTables(new Set());
  }, [datasource, d1ResourceRef, studioSection, supabaseProjectRef]);

  useEffect(() => {
    if (!pageReady || !selectedTable || loadingTables) return;
    if (!activeTables.length) return;
    const exists = Boolean(
      findSelectedTable(activeTables, selectedTable, effectiveDatasource),
    );
    if (!exists) setSelectedTable(null);
  }, [pageReady, activeTables, effectiveDatasource, selectedTable, loadingTables, setSelectedTable]);

  const selectD1Resource = useCallback(
    (nextRef: string) => {
      const match =
        d1Resources.find((row) => row.database_id === nextRef) ||
        d1Resources.find((row) => row.database_name === nextRef) ||
        null;
      setD1ResourceId(match?.database_id || nextRef);
      setD1ResourceName(match?.database_name || nextRef);
      setSelectedTable(null);
      clearD1Tables();
    },
    [d1Resources, clearD1Tables, setD1ResourceId, setD1ResourceName, setSelectedTable],
  );

  const selectSupabaseResource = useCallback((next: string) => {
    setSelectedTable(null);
    clearSupabaseTables();
    if (next === 'platform_supabase') {
      setStudioSection('platform_supabase');
      void loadTables('supabase');
      return;
    }
    setStudioSection('connected_supabase');
    setSupabaseProjectRef(next);
    void loadCustomerSupabaseTables(next);
    if (workspaceId && next) {
      void fetchJson('/api/data-plane/customer-supabase/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_ref: next, project_id: next }),
      }).catch(() => {});
    }
  }, [
    clearSupabaseTables,
    loadCustomerSupabaseTables,
    loadTables,
    setSelectedTable,
    setStudioSection,
    setSupabaseProjectRef,
    workspaceId,
  ]);

  const onSelectD1 = useCallback(() => {
    setSidebarSource('d1');
    setStudioSection('d1');
    setSelectedTable(null);
    if (!d1ResourceRef) clearD1Tables();
  }, [clearD1Tables, d1ResourceRef, setSelectedTable, setSidebarSource, setStudioSection]);

  const onSelectSupabase = useCallback(() => {
    setSidebarSource('supabase');
    setStudioSection(isSuperadmin ? 'platform_supabase' : 'connected_supabase');
    setSelectedTable(null);
    clearSupabaseTables();
    if (!isSuperadmin && supabaseProjectRef) {
      void loadCustomerSupabaseTables(supabaseProjectRef);
    }
  }, [
    clearSupabaseTables,
    isSuperadmin,
    loadCustomerSupabaseTables,
    setSelectedTable,
    setSidebarSource,
    setStudioSection,
    supabaseProjectRef,
  ]);

  const onRefreshTables = useCallback(() => {
    if (studioSection === 'connected_supabase') {
      void loadCustomerSupabaseTables(supabaseProjectRef);
    } else {
      void loadTables(effectiveDatasource);
    }
  }, [effectiveDatasource, loadCustomerSupabaseTables, loadTables, studioSection, supabaseProjectRef]);

  const onboardingEligible = capLoaded && pageReady;
  const activeResourceRef =
    effectiveDatasource === 'd1'
      ? d1ResourceRef
      : studioSection === 'platform_supabase'
        ? 'platform_supabase'
        : supabaseProjectRef.trim();
  const resourceMissing = onboardingEligible && !activeResourceRef;
  const sidebarEmptyMuted = resourceMissing;
  const setupContent =
    !pageReady || !resourceMissing
      ? null
      : (
        <div className="flex h-full items-center justify-center p-8">
          <div className="w-full max-w-lg">
            <SetupCard
              title={effectiveDatasource === 'd1' ? 'Connect Cloudflare D1' : 'Connect Supabase'}
              body={
                effectiveDatasource === 'd1'
                  ? 'Connect Cloudflare, then select an authorized D1 database.'
                  : 'Connect Supabase Management OAuth, then select a project.'
              }
              to={
                effectiveDatasource === 'd1'
                  ? `/api/oauth/cloudflare/start?return_to=${encodeURIComponent('/dashboard/database?studio=1&source=d1')}`
                  : supabaseConnectUrl
              }
            />
          </div>
        </div>
      );

  return {
    activeTables,
    datasourceLabel,
    filteredTables,
    selectD1Resource,
    selectSupabaseResource,
    onSelectD1,
    onSelectSupabase,
    onRefreshTables,
    activeResourceRef,
    resourceMissing,
    sidebarEmptyMuted,
    setupContent,
  };
}
