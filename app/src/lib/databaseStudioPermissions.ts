export type DatabaseStudioPermissionInput = {
  datasource: 'd1' | 'supabase';
  resourceScope: 'platform' | 'connected';
  resourceRef?: string | null;
  capabilityLoaded: boolean;
  isSuperadmin: boolean;
  primaryKey?: string | null;
  selectedTable?: string | null;
  selectedRowCount: number;
};

export function resolveDatabaseStudioPermissions(input: DatabaseStudioPermissionInput) {
  const ownsConnectedD1 =
    input.datasource === 'd1' &&
    input.resourceScope === 'connected' &&
    Boolean(input.resourceRef);

  const canWriteRows = input.capabilityLoaded && (input.isSuperadmin || ownsConnectedD1);
  const hasTable = Boolean(input.selectedTable);
  const hasPrimaryKey = Boolean(input.primaryKey);

  const canEditDataCell = canWriteRows && input.datasource === 'd1' && hasPrimaryKey && hasTable;
  const canInsertRow = canWriteRows && hasTable && input.datasource === 'd1';
  const canDeleteRows =
    canWriteRows &&
    input.datasource === 'd1' &&
    hasTable &&
    hasPrimaryKey &&
    input.selectedRowCount > 0;

  const insertDisabledReason =
    !canWriteRows
      ? 'Insert requires write access on this database.'
      : !hasTable
        ? 'Select a table first.'
        : input.datasource === 'supabase'
          ? 'Use approved SQL with RETURNING for Supabase inserts.'
          : '';

  const deleteDisabledReason =
    !canWriteRows
      ? 'Delete requires write access on this database.'
      : input.datasource === 'supabase'
        ? 'Use approved SQL with RETURNING for Supabase deletes.'
        : !hasPrimaryKey
          ? 'Deleting requires a primary key so rows can be targeted safely.'
          : input.selectedRowCount === 0
            ? 'Select one or more rows to delete.'
            : '';

  const editDisabledReason =
    !canWriteRows
      ? 'Editing requires write access on this database.'
      : input.datasource === 'supabase'
        ? 'Supabase inline edit requires the approved SQL workflow.'
        : !hasPrimaryKey
          ? 'Editing requires a primary key so this row can be updated safely.'
          : !hasTable
            ? 'Select a table first.'
            : '';

  return {
    ownsConnectedD1,
    canWriteRows,
    canEditDataCell,
    canInsertRow,
    canDeleteRows,
    insertDisabledReason,
    deleteDisabledReason,
    editDisabledReason,
  };
}
