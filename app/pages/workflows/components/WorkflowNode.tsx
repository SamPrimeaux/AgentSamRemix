import React from 'react';
import type { WorkflowGraphNode, WorkflowUiNodeType } from '../workflowTypes';
import { apiNodeTypeToUi } from '../workflowTypes';
import { WorkflowNodeIcon, nodeAccent } from '../WorkflowNodeIcon';

export type NodeStatus = 'idle' | 'running' | 'completed' | 'failed';

type Props = {
  node: WorkflowGraphNode;
  status: NodeStatus;
  selected: boolean;
  connectSource: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
};

function statusClass(status: NodeStatus): string {
  if (status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return '';
}

function statusLabel(status: NodeStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
    default:
      return 'Idle';
  }
}

export function WorkflowNode({
  node,
  status,
  selected,
  connectSource,
  onMouseDown,
}: Props) {
  const uiType: WorkflowUiNodeType = apiNodeTypeToUi(node.node_type);
  const accent = nodeAccent(uiType);
  const cls = [
    'wf-node',
    statusClass(status),
    selected || connectSource ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={cls}
      style={{ left: node.x, top: node.y }}
      onMouseDown={onMouseDown}
      role="button"
      tabIndex={0}
      aria-label={node.title}
    >
      <div
        className="wf-node-icon-wrap"
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          display: 'grid',
          placeItems: 'center',
          background: `color-mix(in srgb, ${accent} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
        }}
      >
        <WorkflowNodeIcon type={uiType} size={18} />
      </div>
      <div className="min-w-0">
        <h3>{node.title}</h3>
        <p>{node.description || node.node_type}</p>
        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <span className="wf-tag accent">{node.node_type}</span>
          {node.risk_level && node.risk_level !== 'low' && (
            <span className="wf-tag">{node.risk_level}</span>
          )}
        </div>
        {status !== 'idle' && (
          <div
            style={{
              marginTop: 6,
              fontSize: 9,
              fontFamily: 'var(--wf-font-mono)',
              fontWeight: 800,
              color: status === 'completed' ? 'var(--wf-success)' : status === 'failed' ? 'var(--wf-danger)' : accent,
            }}
          >
            {statusLabel(status)}
          </div>
        )}
      </div>
    </article>
  );
}
