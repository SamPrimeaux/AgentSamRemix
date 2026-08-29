export type DatabaseTableMeta = {
  name: string;
  row_count?: number | null;
  table_schema?: string;
  sql?: string | null;
};

export type DatabaseSchemaColumn = {
  cid?: number;
  name: string;
  type: string;
  notnull?: number | boolean;
  nullable?: boolean;
  dflt_value?: string | null;
  column_default?: string | null;
  pk?: number | boolean;
  constraints?: string[];
};

export type DatabaseIndexMeta = {
  name: string;
  sql?: string | null;
  unique?: boolean | number;
};

export type DatabaseRelationMeta = {
  id?: number;
  from?: string;
  to?: string;
  table?: string;
  target_table?: string;
  target_column?: string;
  source_column?: string;
  direction?: 'inbound' | 'outbound';
};

export type DatabaseDataResponse = {
  rows: Record<string, unknown>[];
  total_count: number;
  columns?: string[];
  page: number;
  total_pages: number;
};

export type DatabaseSortDir = 'asc' | 'desc';
export type DatabaseLoadStatus = 'idle' | 'loading' | 'ok' | 'error';
export type DatabaseSqlRunState = 'idle' | 'running' | 'success' | 'error';

export function quoteDatabaseIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

export function qualifiedDatabaseTableRef(
  table: DatabaseTableMeta,
  datasource: 'd1' | 'supabase',
): string {
  if (datasource === 'd1') return quoteDatabaseIdent(table.name);
  const schema = table.table_schema?.trim();
  if (!schema) throw new Error('Select a Supabase schema before querying a table.');
  return `${schema}.${quoteDatabaseIdent(table.name)}`;
}

export function databaseTableDisplayLabel(table: DatabaseTableMeta, datasource: 'd1' | 'supabase'): string {
  if (datasource === 'd1' || !table.table_schema) return table.name;
  return `${table.table_schema}.${table.name}`;
}

export function databaseTableSelectionKey(table: DatabaseTableMeta, datasource: 'd1' | 'supabase'): string {
  return datasource === 'supabase' && table.table_schema
    ? `${table.table_schema}.${table.name}`
    : table.name;
}

export function findSelectedDatabaseTable(
  tables: DatabaseTableMeta[],
  selection: string,
  datasource: 'd1' | 'supabase',
): DatabaseTableMeta | undefined {
  return tables.find(
    (table) =>
      databaseTableSelectionKey(table, datasource) === selection ||
      (!selection.includes('.') && table.name === selection),
  );
}

export function databaseTableMetaFromSelection(
  selection: string,
  datasource: 'd1' | 'supabase',
): DatabaseTableMeta {
  if (datasource === 'supabase' && selection.includes('.')) {
    const dot = selection.indexOf('.');
    return { table_schema: selection.slice(0, dot), name: selection.slice(dot + 1) };
  }
  return { name: selection };
}

export function normalizeDatabaseTables(payload: unknown): DatabaseTableMeta[] {
  const data = payload as { tables?: unknown[] };
  if (!Array.isArray(data?.tables)) return [];
  return data.tables
    .map((item) => {
      if (typeof item === 'string') return { name: item };
      const row = item as Partial<DatabaseTableMeta> & { tablename?: string; table_name?: string };
      return {
        name: String(row.name ?? row.table_name ?? row.tablename ?? '').trim(),
        row_count: row.row_count == null ? null : Number(row.row_count),
        table_schema: row.table_schema,
        sql: row.sql ?? null,
      };
    })
    .filter((table) => {
      const name = table.name.toLowerCase();
      return table.name && !name.startsWith('sqlite_') && !name.startsWith('_cf_');
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function isDatabasePrimaryKey(column: DatabaseSchemaColumn) {
  return column.pk === true || Number(column.pk) > 0;
}

export function isDatabaseNotNull(column: DatabaseSchemaColumn) {
  return column.notnull === true || Number(column.notnull) > 0 || column.nullable === false;
}

export function databaseColumnDefault(column: DatabaseSchemaColumn) {
  return column.dflt_value ?? column.column_default ?? null;
}
