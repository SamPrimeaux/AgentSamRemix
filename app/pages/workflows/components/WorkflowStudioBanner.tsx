import React from 'react';
import { Play, Plus, Layers } from 'lucide-react';

type Props = {
  workflowName?: string | null;
  workflowKey?: string | null;
  nodeCount?: number;
  edgeCount?: number;
  runStatus?: string;
  isRunning?: boolean;
  onOpenLibrary: () => void;
  onCreateWorkflow: () => void;
  onRun: () => void;
  canRun: boolean;
};

export function WorkflowStudioBanner({
  workflowName,
  workflowKey,
  nodeCount = 0,
  edgeCount = 0,
  runStatus = 'idle',
  isRunning = false,
  onOpenLibrary,
  onCreateWorkflow,
  onRun,
  canRun,
}: Props) {
  const statusDot =
    runStatus === 'running' ? 'running' :
    runStatus === 'awaiting_approval' ? 'warning' :
    runStatus === 'completed' ? 'done' :
    runStatus === 'error' || runStatus === 'failed' ? 'failed' : 'idle';

  return (
    <div className="wf-topbar">
      <div className="wf-topbar-left">
        <span className={`wf-status-dot dot-${statusDot}`} />
        <div className="wf-topbar-name">
          {workflowName || 'Workflow Studio'}
        </div>
        {workflowKey && (
          <span className="wf-topbar-key">{workflowKey}</span>
        )}
        {nodeCount > 0 && (
          <span className="wf-topbar-meta">{nodeCount} nodes · {edgeCount} edges</span>
        )}
      </div>
      <div className="wf-topbar-actions">
        <button type="button" className="wf-btn" onClick={onOpenLibrary} title="Browse workflows">
          <Layers size={13} />
          Library
        </button>
        <button type="button" className="wf-btn" onClick={onCreateWorkflow} title="New workflow">
          <Plus size={13} />
          New
        </button>
        <button
          type="button"
          className="wf-btn primary"
          disabled={!canRun || isRunning}
          onClick={onRun}
          title={canRun ? 'Run this workflow' : 'Select a workflow first'}
        >
          <Play size={13} />
          {isRunning ? 'Running…' : 'Run'}
        </button>
      </div>
    </div>
  );
}
