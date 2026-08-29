import { useCallback, useState } from 'react';

import {
  fetchDatabaseJson,
  isTransientDatabaseFetchError,
} from '../../../src/lib/databaseStudioApi';
import {
  normalizeDatabaseTables,
  type DatabaseLoadStatus,
  type DatabaseTableMeta,
} from '../../../src/lib/databaseStudioModels';

type Datasource = 'd1' | 'supabase';

type UseDatabaseTablesInput = {
  d1FetchInit: (init?: RequestInit) => RequestInit;
  setD1OnboardingRequired: (value: boolean) => void;
};

export function useDatabaseTables({
  d1FetchInit,
  setD1OnboardingRequired,
}: UseDatabaseTablesInput) {
  const [tables, setTables] = useState<Record<Datasource, DatabaseTableMeta[]>>({ d1: [], supabase: [] });
  const [d1Status, setD1Status] = useState<DatabaseLoadStatus>('idle');
  const [d1LoadError, setD1LoadError] = useState<string | null>(null);
  const [hyperStatus, setHyperStatus] = useState<DatabaseLoadStatus>('idle');
  const [loadingTables, setLoadingTables] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);

  const loadCustomerSupabaseTables = useCallback(async (projectRef: string) => {
    if (!projectRef.trim()) {
      setTables((previous) => ({ ...previous, supabase: [] }));
      setHyperStatus('ok');
      return;
    }
    setHyperStatus('loading');
    setLoadingTables(true);
    try {
      const payload = await fetchDatabaseJson<{
        tables?: Array<{ name: string; table_schema?: string }>;
      }>(`/api/data-plane/customer-supabase/tables?project_ref=${encodeURIComponent(projectRef.trim())}`);
      const list = (payload.tables || [])
        .map((table) => ({ name: String(table.name || ''), table_schema: table.table_schema || 'public' }))
        .filter((table) => table.name);
      setTables((previous) => ({ ...previous, supabase: list }));
      setHyperStatus('ok');
    } catch (error) {
      setTables((previous) => ({ ...previous, supabase: [] }));
      setHyperStatus('error');
      setTableError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingTables(false);
    }
  }, []);

  const loadTables = useCallback(async (target: Datasource) => {
    if (target === 'd1') {
      setD1Status('loading');
      setD1LoadError(null);
    } else {
      setHyperStatus('loading');
    }
    setLoadingTables(true);
    const endpoint = target === 'd1'
      ? '/api/d1/tables'
      : '/api/hyperdrive/tables?resource_ref=platform_supabase';

    const loadOnce = async () => {
      const init = target === 'd1'
        ? d1FetchInit({ credentials: 'same-origin' })
        : { credentials: 'same-origin' as const };
      const response = await fetch(endpoint, init);
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setTables((previous) => ({ ...previous, [target]: [] }));
        if (target === 'd1') setD1Status('ok');
        else setHyperStatus('ok');
        return;
      }
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || response.statusText);
      }
      if (target === 'd1') {
        const onboarding = (payload as { onboarding_required?: boolean }).onboarding_required === true;
        setD1OnboardingRequired(onboarding);
        if (onboarding) {
          setD1LoadError(
            (payload as { message?: string }).message ||
              'Connect your Cloudflare D1 to use Database Studio',
          );
        }
      }
      setTables((previous) => ({ ...previous, [target]: normalizeDatabaseTables(payload) }));
      if (target === 'd1') setD1Status('ok');
      else setHyperStatus('ok');
    };

    try {
      try {
        await loadOnce();
      } catch (first) {
        if (!isTransientDatabaseFetchError(first)) throw first;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await loadOnce();
      }
    } catch (error) {
      setTables((previous) => ({ ...previous, [target]: [] }));
      if (target === 'd1') {
        setD1Status('error');
        setD1LoadError(error instanceof Error ? error.message : String(error));
      } else {
        setHyperStatus('error');
        setTableError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setLoadingTables(false);
    }
  }, [d1FetchInit, setD1OnboardingRequired]);

  const clearD1Tables = useCallback(() => {
    setTables((previous) => ({ ...previous, d1: [] }));
  }, []);

  const clearSupabaseTables = useCallback(() => {
    setTables((previous) => ({ ...previous, supabase: [] }));
  }, []);

  return {
    tables,
    d1Status,
    d1LoadError,
    hyperStatus,
    loadingTables,
    tableError,
    setTableError,
    loadTables,
    loadCustomerSupabaseTables,
    clearD1Tables,
    clearSupabaseTables,
  };
}
