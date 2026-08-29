import React from 'react';

export type TableContextMenuAction =
  | 'copy_name'
  | 'copy_schema'
  | 'explore_data'
  | 'edit_schema'
  | 'view_indexes'
  | 'view_relations'
  | 'delete';

type Props = {
  x: number;
  y: number;
  canDelete: boolean;
  canCopySchema: boolean;
  onAction: (action: TableContextMenuAction) => void;
};

export function DatabaseTableContextMenu({ x, y, canDelete, canCopySchema, onAction }: Props) {
  return (
    <div
      className="database-table-menu"
      style={{ top: y, left: x }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={() => onAction('copy_name')}>
        Copy table name
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!canCopySchema}
        title={canCopySchema ? undefined : 'Schema SQL available for D1 tables'}
        onClick={() => onAction('copy_schema')}
      >
        Copy table schema
      </button>
      <button type="button" role="menuitem" onClick={() => onAction('explore_data')}>
        Explore Data
      </button>
      <button type="button" role="menuitem" onClick={() => onAction('edit_schema')}>
        Edit table schema
      </button>
      <div className="database-table-menu-sep" role="separator" />
      <button type="button" role="menuitem" onClick={() => onAction('view_indexes')}>
        View indexes
      </button>
      <button type="button" role="menuitem" onClick={() => onAction('view_relations')}>
        View relations
      </button>
      {canDelete ? (
        <>
          <div className="database-table-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="database-table-menu-danger"
            onClick={() => onAction('delete')}
          >
            Delete
          </button>
        </>
      ) : null}
    </div>
  );
}
