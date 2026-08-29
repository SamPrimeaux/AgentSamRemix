import React from 'react';
import type { InspectorTab, WorkflowGraph } from '../workflowTypes';
import type { WorkflowRunState } from '../../../components/ChatAssistant/components/WorkflowRunBoard';
import { WorkflowConfigPanel } from './WorkflowConfigPanel';
import { WorkflowRunPanel } from './WorkflowRunPanel';
import { WorkflowCostPanel } from './WorkflowCostPanel';

type Props = {
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  graph: WorkflowGraph | null;
  selectedNodeKey: string | null;
  connectFrom: string | null;
  onGraphChanged: () => void;
  onConnectFrom: (key: string | null) => void;
  runState: WorkflowRunState;
  onApprove: (decision: 'approved' | 'denied') => Promise<void>;
  approvalBusy: boolean;
  onStartRun: () => void;
  canRun: boolean;
  isRunning: boolean;
};

export function WorkflowInspector({
  tab,
  onTab,
  graph,
  selectedNodeKey,
  connectFrom,
  onGraphChanged,
  onConnectFrom,
  runState,
  onApprove,
  approvalBusy,
  onStartRun,
  canRun,
  isRunning,
}: Props) {
  const tabs: { id: InspectorTab; label: string }[] = [
    { id: 'config', label: 'Config' },
    { id: 'run', label: 'Run' },
    { id: 'cost', label: 'Cost' },
  ];

  return (
    <aside className="wf-inspector" aria-label="Workflow inspector">
      <div className="wf-inspector-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`wf-inspector-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="wf-inspector-body">
        {tab === 'config' && (
          <WorkflowConfigPanel
            graph={graph}
            selectedNodeKey={selectedNodeKey}
            connectFrom={connectFrom}
            onGraphChanged={onGraphChanged}
            onConnectFrom={onConnectFrom}
          />
        )}
        {tab === 'run' && (
          <WorkflowRunPanel
            runState={runState}
            onApprove={onApprove}
            approvalBusy={approvalBusy}
            onStartRun={onStartRun}
            canRun={canRun}
            isRunning={isRunning}
          />
        )}
        {tab === 'cost' && <WorkflowCostPanel graph={graph} runState={runState} />}
      </div>
    </aside>
  );
}
