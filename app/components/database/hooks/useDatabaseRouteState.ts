import { useCallback, useEffect, useRef, useState } from 'react';

import {
  parseDatabaseStudioSection,
  resolveDatabaseStudioDatasource,
  type DatabaseStudioDatasource,
  type DatabaseStudioSection,
} from '../../../src/lib/databaseStudioRoute';

const LS_DATASOURCE = 'iam.database.datasource';
const LS_TABLE = 'iam.database.selectedTable';

export type DatabaseStudioMetaPanel = 'schema' | 'indexes' | 'relations';

export function readStoredDatasource(): DatabaseStudioDatasource {
  try {
    const value = localStorage.getItem(LS_DATASOURCE);
    if (value === 'd1' || value === 'supabase') return value;
    if (value === 'hyperdrive') return 'supabase';
  } catch {
    // Ignore storage failures.
  }
  return 'supabase';
}

type RouteInput = {
  searchParams: URLSearchParams;
  setSearchParams: (next: URLSearchParams, opts?: { replace?: boolean }) => void;
  databaseName?: string;
  d1ResourceScope: 'platform' | 'connected';
  d1ResourceRef: string;
  supabaseProjectRef: string;
  /** Resource identity changed (named D1 path), not query-string hydration. */
  onNamedDatabaseBound?: (name: string) => void;
};

export function useDatabaseRouteState({
  searchParams,
  setSearchParams,
  databaseName,
  d1ResourceScope,
  d1ResourceRef,
  supabaseProjectRef,
  onNamedDatabaseBound,
}: RouteInput) {
  const [sidebarSource, setSidebarSource] = useState<DatabaseStudioDatasource>(readStoredDatasource);
  const [selectedTable, setSelectedTable] = useState<string | null>(() => {
    const fromUrl = searchParams.get('table')?.trim();
    if (fromUrl) return fromUrl;
    try {
      return localStorage.getItem(LS_TABLE);
    } catch {
      return null;
    }
  });
  const [metaPanel, setMetaPanel] = useState<DatabaseStudioMetaPanel | null>(() => {
    const panel = searchParams.get('panel');
    return panel === 'schema' || panel === 'indexes' || panel === 'relations' ? panel : null;
  });
  const [studioSection, setStudioSection] = useState<DatabaseStudioSection>(() => {
    if (searchParams.get('source') === 'supabase' && searchParams.get('resource_scope') === 'connected') {
      return 'connected_supabase';
    }
    return parseDatabaseStudioSection(searchParams.get('source')) || 'd1';
  });

  const lastNamedDatabaseRef = useRef('');
  const namedBoundRef = useRef(onNamedDatabaseBound);
  namedBoundRef.current = onNamedDatabaseBound;
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const effectiveDatasource = resolveDatabaseStudioDatasource(studioSection, sidebarSource);

  useEffect(() => {
    const name = databaseName?.trim() || '';
    if (!name) {
      lastNamedDatabaseRef.current = '';
      return;
    }
    if (lastNamedDatabaseRef.current === name) return;
    lastNamedDatabaseRef.current = name;
    namedBoundRef.current?.(name);
    // Resource identity only — do not re-bind when panel/table query params hydrate.
    if (!searchParamsRef.current.get('source')) {
      setStudioSection('d1');
      setSidebarSource('d1');
    }
  }, [databaseName]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_DATASOURCE, sidebarSource);
    } catch {
      /* ignore */
    }
  }, [sidebarSource]);

  useEffect(() => {
    try {
      if (selectedTable) localStorage.setItem(LS_TABLE, selectedTable);
      else localStorage.removeItem(LS_TABLE);
    } catch {
      /* ignore */
    }
  }, [selectedTable]);

  useEffect(() => {
    const activePanel = metaPanel || (selectedTable ? 'data' : 'sql');
    const resourceScope =
      effectiveDatasource === 'd1'
        ? d1ResourceScope
        : studioSection === 'platform_supabase'
          ? 'platform'
          : 'connected';
    const resourceRef =
      effectiveDatasource === 'd1'
        ? d1ResourceRef
        : studioSection === 'platform_supabase'
          ? 'platform_supabase'
          : supabaseProjectRef.trim();
    const currentSource = searchParams.get('source');
    const currentScope = searchParams.get('resource_scope');
    const currentResource = searchParams.get('resource_ref') || '';
    const currentPanel = searchParams.get('panel');
    const currentTable = searchParams.get('table') || '';
    const nextTable = selectedTable || '';
    if (
      currentSource === effectiveDatasource &&
      currentScope === resourceScope &&
      currentResource === resourceRef &&
      currentPanel === activePanel &&
      currentTable === nextTable
    ) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('studio', '1');
    next.set('source', effectiveDatasource);
    next.set('resource_scope', resourceScope);
    if (resourceRef) next.set('resource_ref', resourceRef);
    else next.delete('resource_ref');
    next.set('panel', activePanel);
    if (selectedTable) next.set('table', selectedTable);
    else next.delete('table');
    setSearchParams(next, { replace: true });
  }, [
    d1ResourceRef,
    d1ResourceScope,
    effectiveDatasource,
    metaPanel,
    searchParams,
    selectedTable,
    setSearchParams,
    studioSection,
    supabaseProjectRef,
  ]);

  const clearSelectedTable = useCallback(() => {
    setSelectedTable(null);
    setMetaPanel(null);
  }, []);

  return {
    sidebarSource,
    setSidebarSource,
    studioSection,
    setStudioSection,
    selectedTable,
    setSelectedTable,
    metaPanel,
    setMetaPanel,
    effectiveDatasource,
    clearSelectedTable,
  };
}
