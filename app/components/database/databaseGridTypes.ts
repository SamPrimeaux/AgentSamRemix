export type GridCellSource = 'sql_result' | 'data_tab';

export type GridDatasource = 'd1' | 'supabase';

export type SelectedGridCell = {
  source: GridCellSource;
  datasource: GridDatasource;
  table?: string;
  rowIndex: number;
  rowKey: string;
  columnKey: string;
  value: unknown;
  row: Record<string, unknown>;
  editable: boolean;
  reasonIfNotEditable?: string;
};

export function rowKeyForRow(row: Record<string, unknown>, pk: string | undefined, rowIndex: number): string {
  if (pk && row[pk] != null) return String(row[pk]);
  return String(rowIndex);
}

export function cellMatches(a: SelectedGridCell | null, rowKey: string, columnKey: string): boolean {
  return Boolean(a && a.rowKey === rowKey && a.columnKey === columnKey);
}
