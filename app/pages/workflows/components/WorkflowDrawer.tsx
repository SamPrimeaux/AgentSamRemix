import React from 'react';
import { X } from 'lucide-react';
import type { DrawerMode, WorkflowListItem } from '../workflowTypes';
import { EXECUTOR_NODE_TYPES } from '../workflowTypes';
import { WorkflowLibraryView } from './WorkflowLibraryView';
import { WorkflowConnectionsView } from './WorkflowConnectionsView';

const DRAWER_TITLES: Record<Exclude<DrawerMode, null>, { title: string; kicker: string }> = {
  blocks: { title: 'Workflow Blocks', kicker: 'actions + stages' },
  library: { title: 'Workflow Library', kicker: 'saved + metrics' },
  connections: { title: 'Connections', kicker: 'databases + tools' },
};

type Props = {
  mode: DrawerMode;
  onClose: () => void;
  onToast: (msg: string) => void;
  workflows: WorkflowListItem[];
  listLoading: boolean;
  listError: string | null;
  selectedRegistryId: string | null;
  onSelectWorkflow: (id: string) => void;
  onRefreshList: () => void;
  onAddBlock: (nodeType: string) => void;
  onAutoLayout: () => void;
  onRun: () => void;
  canRun: boolean;
  isRunning: boolean;
  onCreateWorkflow?: () => void;
};

export function WorkflowDrawer({
  mode,
  onClose,
  onToast,
  workflows,
  listLoading,
  listError,
  selectedRegistryId,
  onSelectWorkflow,
  onRefreshList,
  onAddBlock,
  onAutoLayout,
  onRun,
  canRun,
  isRunning,
  onCreateWorkflow,
}: Props) {
  if (!mode) return null;
  const head = DRAWER_TITLES[mode];

  return (
    <section className={`wf-drawer open`} aria-label={`${head.title} drawer`}>
      <div className="wf-drawer-head">
        <div>
          <div className="wf-drawer-title">{head.title}</div>
          <div className="wf-drawer-kicker">{head.kicker}</div>
        </div>
        <button type="button" className="wf-btn icon" onClick={onClose} title="Close drawer">
          <X size={14} />
        </button>
      </div>

      {mode === 'blocks' && (
        <>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--wf-border)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Workflow actions</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button type="button" className="wf-btn primary" disabled={!canRun || isRunning} onClick={onRun}>
                Run
              </button>
              <button type="button" className="wf-btn" onClick={onAutoLayout}>
                Auto layout
              </button>
            </div>
          </div>
          <div className="wf-drawer-body" style={{ padding: 12 }}>
            <p style={{ fontSize: 10, color: 'var(--wf-muted)', margin: '0 0 10px' }}>
              Click a block type to add a stage (configure node_key in inspector).
            </p>
            {EXECUTOR_NODE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className="wf-library-card"
                style={{ gridTemplateColumns: '1fr' }}
                onClick={() => onAddBlock(t.value)}
              >
                <div style={{ fontSize: 12, fontWeight: 800 }}>{t.label}</div>
                <div style={{ fontSize: 10, color: 'var(--wf-muted)' }}>{t.value}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {mode === 'library' && (
        <WorkflowLibraryView
          workflows={workflows}
          loading={listLoading}
          error={listError}
          selectedId={selectedRegistryId}
          onSelect={onSelectWorkflow}
          onRefresh={onRefreshList}
          onCreate={onCreateWorkflow}
        />
      )}

      {mode === 'connections' && <WorkflowConnectionsView onToast={onToast} />}
    </section>
  );
}
