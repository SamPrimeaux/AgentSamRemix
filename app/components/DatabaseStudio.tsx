/**
 * DatabaseStudio — lazy-mounted SQL explorer for /dashboard/database (Studio mode).
 *
 * D1 Studio–style explorer: searchable table sidebar, single SQL editor, results grid.
 * Schema / indexes / relations open from per-table context menu (not top-level tabs).
 * Orchestration peeled to database/hooks/useDatabaseStudioController.ts.
 */

import React from 'react';
import {
  AlertTriangle,
  Loader2,
  X,
} from 'lucide-react';

import { DatabaseSqlConfirmModal } from './database/DatabaseSqlConfirmModal';
import { DatabaseDropTableModal } from './database/DatabaseDropTableModal';
import { DatabaseTableContextMenu } from './database/DatabaseTableContextMenu';
import { DatabaseCellDetailDrawer } from './database/DatabaseCellDetailDrawer';
import { DatabaseStudioHeader } from './database/layout/DatabaseStudioHeader';
import { DatabaseTablesRail } from './database/layout/DatabaseTablesRail';
import { DatabaseMetadataDrawer } from './database/layout/DatabaseMetadataDrawer';
import { DatabaseSqlResultsWorkspace } from './database/workspace/DatabaseSqlResultsWorkspace';
import { DatabaseInsertRowDrawer } from './database/workspace/DatabaseInsertRowDrawer';
import {
  useDatabaseStudioController,
  type DatabaseStudioProps,
} from './database/hooks/useDatabaseStudioController';
import '../components/database/database-page.css';

export type { DatabaseStudioProps };

export const DatabaseStudio: React.FC<DatabaseStudioProps> = ({ databaseName, onBackToOverview }) => {
  const c = useDatabaseStudioController({ databaseName, onBackToOverview });

  const {
    studioShellRef,
    sidebarWidth,
    sidebarCollapsed,
    sidebarDragging,
    beginSidebarResize,
    toggleSidebarCollapsed,
    effectiveDatasource,
    isSuperadmin,
    supabaseConnected,
    supabaseConnectUrl,
    tableSearch,
    setTableSearch,
    filteredTables,
    selectedTable,
    expandedTables,
    columnCache,
    columnLoading,
    pageReady,
    loadingTables,
    d1LoadError,
    d1OnboardingRequired,
    sidebarEmptyMuted,
    onSelectD1,
    onSelectSupabase,
    onRefreshTables,
    clearSql,
    onPickTable,
    toggleColumns,
    setTableMenu,
    tableMenu,
    canWriteRows,
    onTableMenuAction,
    menuToast,
    datasourceLabel,
    d1Resources,
    d1ResourceRef,
    selectD1Resource,
    studioSection,
    supabaseProjectRef,
    supabaseProjects,
    platformSupabase,
    selectSupabaseResource,
    cellDetail,
    setCellDetail,
    copyToClipboard,
    selectedCell,
    setSelectedCell,
    applyCellEdit,
    pk,
    sqlStackRef,
    sql,
    setSql,
    sqlEditorRef,
    resultsPaneHeight,
    splitterDragging,
    beginResultsPaneResize,
    resetResultsPaneHeight,
    sqlRunState,
    lastQueryMs,
    lastRowsRead,
    sqlRunning,
    runSql,
    canInsertRow,
    insertDisabledReason,
    setDrawer,
    canDeleteRows,
    deleteDisabledReason,
    setDeleteRowsModal,
    refreshTableRows,
    page,
    loadingMain,
    copyVisibleDataCsv,
    selectedRows,
    setSelectedRows,
    filters,
    setFilters,
    schema,
    applyFiltersToTable,
    sqlResults,
    sqlColumns,
    sqlError,
    lastAttemptedSql,
    exportSqlResultsCsv,
    openCellDetail,
    editingCell,
    setEditingCell,
    getDataCellEditable,
    data,
    browseMeta,
    selectedTableMeta,
    tableBrowseTotalPages,
    sortCol,
    sortDir,
    setSortCol,
    setSortDir,
    setupContent,
    metaPanel,
    setMetaPanel,
    selectedTableSqlName,
    indexes,
    relations,
    sqlConfirmModal,
    setSqlConfirmModal,
    confirmSqlModalRun,
    dropTableModal,
    dropTableBusy,
    setDropTableModal,
    confirmDropTable,
    deleteRowsModal,
    deleteSelectedRows,
    drawer,
    insertValues,
    setInsertValues,
    insertSql,
    insertRow,
    dataError,
    tableError,
    setDataError,
    setTableError,
  } = c;

  return (
    <div ref={studioShellRef} className="database-page relative flex h-full min-h-0 overflow-hidden">
      <DatabaseTablesRail
        width={sidebarWidth}
        collapsed={sidebarCollapsed}
        dragging={sidebarDragging}
        effectiveDatasource={effectiveDatasource}
        isSuperadmin={isSuperadmin}
        supabaseConnected={supabaseConnected}
        supabaseConnectUrl={supabaseConnectUrl}
        tableSearch={tableSearch}
        onTableSearchChange={setTableSearch}
        filteredTables={filteredTables}
        selectedTable={selectedTable}
        expandedTables={expandedTables}
        columnCache={columnCache}
        columnLoading={columnLoading}
        pageReady={pageReady}
        loadingTables={loadingTables}
        d1LoadError={d1LoadError}
        d1OnboardingRequired={d1OnboardingRequired}
        sidebarEmptyMuted={sidebarEmptyMuted}
        onSelectD1={onSelectD1}
        onSelectSupabase={onSelectSupabase}
        onRefreshTables={onRefreshTables}
        onClearSql={clearSql}
        onExpandSidebar={toggleSidebarCollapsed}
        onBeginResize={beginSidebarResize}
        onToggleCollapsed={toggleSidebarCollapsed}
        onPickTable={onPickTable}
        onToggleColumns={toggleColumns}
        onOpenTableMenu={(selectionKey, x, y) => setTableMenu({ table: selectionKey, x, y })}
      />

      {tableMenu && (
        <DatabaseTableContextMenu
          x={tableMenu.x}
          y={tableMenu.y}
          canDelete={canWriteRows && effectiveDatasource === 'd1'}
          canCopySchema
          onAction={(action) => {
            void onTableMenuAction(action);
          }}
        />
      )}

      {menuToast ? (
        <div
          className="fixed bottom-16 left-1/2 z-[90] max-w-[90vw] -translate-x-1/2 rounded-lg border border-[var(--database-border)] bg-[var(--database-panel)] px-3 py-2 font-mono text-[11px] text-[var(--database-text)] shadow-lg"
          role="status"
        >
          {menuToast}
        </div>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        <DatabaseStudioHeader
          onBackToOverview={onBackToOverview}
          selectedTable={selectedTable}
          datasourceLabel={datasourceLabel}
          canWriteRows={canWriteRows}
          showD1Picker={effectiveDatasource === 'd1' && d1Resources.length > 0}
          showSupabasePicker={effectiveDatasource === 'supabase' && (isSuperadmin || supabaseConnected)}
          d1ResourceRef={d1ResourceRef}
          d1Resources={d1Resources}
          onSelectD1Resource={selectD1Resource}
          isSuperadmin={isSuperadmin}
          studioSection={studioSection}
          supabaseProjectRef={supabaseProjectRef}
          supabaseProjects={supabaseProjects}
          platformSupabase={platformSupabase}
          onSelectSupabaseResource={selectSupabaseResource}
        />

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <DatabaseCellDetailDrawer

            payload={cellDetail}
            onClose={() => setCellDetail(null)}
            onCopy={(t) => void copyToClipboard(t)}
            onCopyRowJson={
              selectedCell
                ? () => void copyToClipboard(JSON.stringify(selectedCell.row, null, 2))
                : undefined
            }
            onApplyEdit={
              selectedCell?.editable && selectedTable && pk
                ? (nextValue) => applyCellEdit(selectedCell, nextValue)
                : undefined
            }
          />
          <DatabaseSqlResultsWorkspace
            setupContent={setupContent}
            sqlStackRef={sqlStackRef}
            selectedCell={selectedCell}
            setSelectedCell={setSelectedCell}
            setCellDetail={setCellDetail}
            copyToClipboard={copyToClipboard}
            applyCellEdit={applyCellEdit}
            selectedTable={selectedTable}
            pk={pk}
            sql={sql}
            setSql={setSql}
            sqlEditorRef={sqlEditorRef}
            resultsPaneHeight={resultsPaneHeight}
            splitterDragging={splitterDragging}
            beginResultsPaneResize={beginResultsPaneResize}
            resetResultsPaneHeight={resetResultsPaneHeight}
            sqlRunState={sqlRunState}
            lastQueryMs={lastQueryMs}
            lastRowsRead={lastRowsRead}
            effectiveDatasource={effectiveDatasource}
            sqlRunning={sqlRunning}
            runSql={runSql}
            canInsertRow={canInsertRow}
            insertDisabledReason={insertDisabledReason}
            setDrawer={setDrawer}
            canDeleteRows={canDeleteRows}
            deleteDisabledReason={deleteDisabledReason}
            setDeleteRowsModal={setDeleteRowsModal}
            refreshTableRows={refreshTableRows}
            page={page}
            loadingMain={loadingMain}
            copyVisibleDataCsv={copyVisibleDataCsv}
            selectedRows={selectedRows}
            setSelectedRows={setSelectedRows}
            filters={filters}
            setFilters={setFilters}
            schema={schema}
            applyFiltersToTable={applyFiltersToTable}
            sqlResults={sqlResults}
            sqlColumns={sqlColumns}
            sqlError={sqlError}
            lastAttemptedSql={lastAttemptedSql}
            datasourceLabel={datasourceLabel}
            exportSqlResultsCsv={exportSqlResultsCsv}
            openCellDetail={openCellDetail}
            canWriteRows={canWriteRows}
            editingCell={editingCell}
            setEditingCell={setEditingCell}
            getDataCellEditable={getDataCellEditable}
            data={data}
            browseMeta={browseMeta}
            selectedTableMeta={selectedTableMeta}
            tableBrowseTotalPages={tableBrowseTotalPages}
            sortCol={sortCol}
            sortDir={sortDir}
            setSortCol={setSortCol}
            setSortDir={setSortDir}
          />

          {metaPanel && selectedTable && !setupContent && (
            <DatabaseMetadataDrawer
              table={selectedTable}
              panel={metaPanel}
              datasourceLabel={datasourceLabel}
              canWriteRows={canWriteRows}
              selectedTableSqlName={selectedTableSqlName}
              schema={schema}
              indexes={indexes}
              relations={relations}
              onClose={() => setMetaPanel(null)}
              onApplySql={(nextSql) => {
                setSql(nextSql);
                setMetaPanel(null);
              }}
            />
          )}
        </div>
      </main>

      <DatabaseSqlConfirmModal
        payload={sqlConfirmModal}
        onCancel={() => setSqlConfirmModal(null)}
        onConfirm={() => confirmSqlModalRun()}
      />

      <DatabaseDropTableModal
        tableName={dropTableModal}
        busy={dropTableBusy}
        onCancel={() => {
          if (!dropTableBusy) setDropTableModal(null);
        }}
        onConfirm={() => {
          void confirmDropTable();
        }}
      />

      {deleteRowsModal && selectedTable && (
        <div className="database-modal-overlay" role="dialog" aria-modal="true">
          <div className="database-modal-panel">
            <div className="border-b border-[var(--database-border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--database-text)]">Delete rows</h2>
              <p className="mt-1 text-[11px] text-[var(--database-text-muted)]">
                Delete {selectedRows.size} row(s) from <span className="font-mono">{selectedTable}</span>? This cannot be undone.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3">
              <button type="button" onClick={() => setDeleteRowsModal(false)} className="rounded-lg border border-[var(--database-border)] px-3 py-2 text-[11px] font-bold">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteSelectedRows()}
                className="rounded-lg border border-[var(--database-error-text)]/40 bg-[var(--database-error-bg)] px-3 py-2 text-[11px] font-bold text-[var(--database-error-text)]"
              >
                Delete {selectedRows.size} row(s)
              </button>
            </div>
          </div>
        </div>
      )}

      <DatabaseInsertRowDrawer
        drawer={drawer}
        selectedTable={selectedTable}
        schema={schema}
        insertValues={insertValues}
        setInsertValues={setInsertValues}
        insertSql={insertSql}
        setDrawer={setDrawer}
        insertRow={insertRow}
      />

      {loadingMain && (
        <div
          className="pointer-events-none absolute top-0 flex items-center gap-2 rounded-br-lg border-b border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 text-[11px] text-muted"
          style={{ left: sidebarWidth }}
        >
          <Loader2 size={12} className="animate-spin" /> Loading
        </div>
      )}
      {(dataError || tableError) && !drawer && (
        <div className="absolute bottom-3 left-1/2 flex max-w-xl -translate-x-1/2 items-center gap-2 rounded-lg border border-[var(--solar-red)]/30 bg-[var(--bg-panel)] px-3 py-2 text-[12px] text-[var(--solar-red)]">
          <AlertTriangle size={13} /> {dataError || tableError}
          <button type="button" onClick={() => { setDataError(null); setTableError(null); }}>
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
};

export default DatabaseStudio;
