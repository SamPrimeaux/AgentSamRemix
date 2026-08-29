import { useCallback, useState } from 'react';

import { databaseTableApiPath, fetchDatabaseJson } from '../../../src/lib/databaseStudioApi';
import {
  databaseTableMetaFromSelection,
  findSelectedDatabaseTable,
  type DatabaseIndexMeta,
  type DatabaseRelationMeta,
  type DatabaseSchemaColumn,
  type DatabaseTableMeta,
} from '../../../src/lib/databaseStudioModels';

type Datasource = 'd1' | 'supabase';
type StudioSection = 'd1' | 'platform_supabase' | 'connected_supabase';

type UseDatabaseTableMetadataInput = {
  activeTables: DatabaseTableMeta[];
  datasource: Datasource;
  studioSection: StudioSection;
  supabaseProjectRef: string;
  fetchD1Json: <T>(url: string, init?: RequestInit) => Promise<T>;
};

export function useDatabaseTableMetadata({
  activeTables,
  datasource,
  studioSection,
  supabaseProjectRef,
  fetchD1Json,
}: UseDatabaseTableMetadataInput) {
  const [schema, setSchema] = useState<DatabaseSchemaColumn[]>([]);
  const [indexes, setIndexes] = useState<DatabaseIndexMeta[]>([]);
  const [relations, setRelations] = useState<DatabaseRelationMeta[]>([]);
  const [columnCache, setColumnCache] = useState<Record<string, DatabaseSchemaColumn[]>>({});
  const [columnLoading, setColumnLoading] = useState<Record<string, boolean>>({});
  const [loadingMetadata, setLoadingMetadata] = useState(false);

  const resolveMeta = useCallback((table: string) => {
    return findSelectedDatabaseTable(activeTables, table, datasource)
      ?? databaseTableMetaFromSelection(table, datasource);
  }, [activeTables, datasource]);

  const loadSchema = useCallback(async (table: string) => {
    setLoadingMetadata(true);
    try {
      const meta = resolveMeta(table);
      const path = databaseTableApiPath(
        meta,
        datasource,
        'schema',
        studioSection === 'connected_supabase' ? supabaseProjectRef : '',
      );
      const payload = datasource === 'd1'
        ? await fetchD1Json<{
            columns?: DatabaseSchemaColumn[];
            schema?: DatabaseSchemaColumn[];
            indexes?: DatabaseIndexMeta[];
            foreign_keys?: DatabaseRelationMeta[];
          }>(path)
        : await fetchDatabaseJson<{
            columns?: DatabaseSchemaColumn[];
            schema?: DatabaseSchemaColumn[];
            indexes?: DatabaseIndexMeta[];
            foreign_keys?: DatabaseRelationMeta[];
          }>(path);
      setSchema(payload.columns || payload.schema || []);
      setIndexes(payload.indexes || []);
      setRelations(payload.foreign_keys || []);
    } finally {
      setLoadingMetadata(false);
    }
  }, [datasource, fetchD1Json, resolveMeta, studioSection, supabaseProjectRef]);

  const loadColumns = useCallback(async (table: string) => {
    if (columnCache[table] || columnLoading[table]) return;
    setColumnLoading((current) => ({ ...current, [table]: true }));
    try {
      const meta = resolveMeta(table);
      const path = databaseTableApiPath(
        meta,
        datasource,
        'schema',
        studioSection === 'connected_supabase' ? supabaseProjectRef : '',
      );
      const payload = datasource === 'd1'
        ? await fetchD1Json<{ columns?: DatabaseSchemaColumn[]; schema?: DatabaseSchemaColumn[] }>(path)
        : await fetchDatabaseJson<{ columns?: DatabaseSchemaColumn[]; schema?: DatabaseSchemaColumn[] }>(path);
      setColumnCache((current) => ({ ...current, [table]: payload.columns || payload.schema || [] }));
    } catch {
      setColumnCache((current) => ({ ...current, [table]: [] }));
    } finally {
      setColumnLoading((current) => ({ ...current, [table]: false }));
    }
  }, [columnCache, columnLoading, datasource, fetchD1Json, resolveMeta, studioSection, supabaseProjectRef]);

  const resetMetadata = useCallback(() => {
    setSchema([]);
    setIndexes([]);
    setRelations([]);
  }, []);

  const clearColumnCache = useCallback(() => {
    setColumnCache({});
    setColumnLoading({});
  }, []);

  return {
    schema,
    indexes,
    relations,
    columnCache,
    columnLoading,
    loadingMetadata,
    loadSchema,
    loadColumns,
    resetMetadata,
    clearColumnCache,
  };
}
