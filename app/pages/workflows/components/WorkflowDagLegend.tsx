import React from 'react';

// Minimal inline legend — tiny pill row, doesn't block canvas
export function WorkflowDagLegend() {
  return (
    <div className="wf-legend-bar" aria-label="Step status legend">
      <span className="wf-legend-item"><span className="wf-ldot idle" />Idle</span>
      <span className="wf-legend-sep" />
      <span className="wf-legend-item"><span className="wf-ldot running" />Running</span>
      <span className="wf-legend-sep" />
      <span className="wf-legend-item"><span className="wf-ldot done" />Done</span>
      <span className="wf-legend-sep" />
      <span className="wf-legend-item"><span className="wf-ldot failed" />Failed</span>
    </div>
  );
}
