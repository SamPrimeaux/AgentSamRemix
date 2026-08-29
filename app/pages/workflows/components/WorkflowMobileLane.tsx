import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { WorkflowGraph } from '../workflowTypes';
import { AppIcon } from '../../../components/ui/AppIcon';
import { resolveWorkflowNodeBrand } from '../lib/resolveWorkflowNodeBrand';
import type { NodeStatus } from './WorkflowNode';

type Props = {
  graph: WorkflowGraph;
  selectedNodeKey: string | null;
  nodeStatuses: Record<string, NodeStatus>;
  onSelectNode: (key: string | null) => void;
  onOpenInspector?: () => void;
};

function statusPill(status: NodeStatus): { label: string; className: string; spin?: boolean } {
  switch (status) {
    case 'running':
      return { label: 'Running', className: 'is-running', spin: true };
    case 'completed':
      return { label: 'Completed', className: 'is-done' };
    case 'failed':
      return { label: 'Failed', className: 'is-failed' };
    default:
      return { label: 'Waiting', className: 'is-waiting' };
  }
}

function orderedNodes(graph: WorkflowGraph) {
  const order = graph.executionOrder.filter((k) => graph.nodes.some((n) => n.node_key === k));
  if (order.length) {
    return order.map((k) => graph.nodes.find((n) => n.node_key === k)!).filter(Boolean);
  }
  return [...graph.nodes].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export function WorkflowMobileLane({
  graph,
  selectedNodeKey,
  nodeStatuses,
  onSelectNode,
  onOpenInspector,
}: Props) {
  const nodes = orderedNodes(graph);

  return (
    <div className="wf-mobile-lane" aria-label={`${graph.displayName} workflow steps`}>
      <div className="wf-mobile-lane-head">
        <div>
          <h2 className="wf-mobile-lane-title">{graph.displayName}</h2>
          <p className="wf-mobile-lane-meta">
            {nodes.length} apps · {graph.edges.length} links · tap a step to inspect
          </p>
        </div>
        {onOpenInspector ? (
          <button type="button" className="wf-btn" onClick={onOpenInspector}>
            Config
          </button>
        ) : null}
      </div>

      <ol className="wf-mobile-lane-list">
        {nodes.map((node, index) => {
          const brand = resolveWorkflowNodeBrand(node, graph.workflowKey);
          const status = nodeStatuses[node.node_key] ?? 'idle';
          const pill = statusPill(status);
          const selected = selectedNodeKey === node.node_key;

          return (
            <li key={node.node_key} className={`wf-mobile-lane-item${selected ? ' is-selected' : ''}`}>
              {index > 0 ? <span className="wf-mobile-lane-spine" aria-hidden /> : null}
              <button
                type="button"
                className="wf-mobile-lane-row"
                onClick={() => onSelectNode(selected ? null : node.node_key)}
              >
                <span className="wf-mobile-lane-icon-wrap">
                  <AppIcon
                    title={node.title}
                    imageUrl={brand.imageUrl}
                    iconSlug={brand.iconSlug}
                    size="md"
                    presentation={brand.presentation}
                    subtitle=""
                    className="wf-mobile-lane-icon"
                  />
                </span>
                <span className="wf-mobile-lane-copy">
                  <strong>{node.title}</strong>
                  <span>{brand.laneLabel}</span>
                </span>
                <span className={`wf-mobile-lane-pill ${pill.className}`}>
                  {pill.spin ? <Loader2 size={11} className="animate-spin" aria-hidden /> : null}
                  {pill.className === 'is-done' ? <Check size={11} strokeWidth={2.5} aria-hidden /> : null}
                  {pill.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
