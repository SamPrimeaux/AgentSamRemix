import React from 'react';
import type { MeshStats, WorkspaceId } from '../cadStudioTypes';
import type { JobStatus } from '../useCadStudioProtocol';

export type StatusBarProps = {
  selectedName: string | null;
  meshStats: MeshStats;
  memoryMb?: number;
  workspace: WorkspaceId;
  engine: string;
  jobStatus: JobStatus;
  statusMessage: string;
  runnerLabel: string;
  sceneBusy?: boolean;
  saveLabel?: string;
};

export function StatusBar({
  selectedName,
  meshStats,
  memoryMb,
  workspace,
  engine,
  jobStatus,
  statusMessage,
  runnerLabel,
  sceneBusy,
  saveLabel,
}: StatusBarProps) {
  return (
    <footer className="cad-studio__statusbar">
      <div className="cad-studio__statusbar-left">
        <span className={`cad-studio__dot-status cad-studio__dot-status--${jobStatus}`} />
        <span>{statusMessage}</span>
        {sceneBusy ? <span className="cad-studio__save-hint">{saveLabel ?? 'Saving…'}</span> : null}
      </div>
      <div className="cad-studio__statusbar-center">
        <span>{selectedName ?? 'Object'}</span>
        <span>|</span>
        <span>V {meshStats.verts}</span>
        <span>E {meshStats.edges}</span>
        <span>F {meshStats.faces}</span>
        <span>Tris {meshStats.tris}</span>
        {memoryMb != null ? (
          <>
            <span>|</span>
            <span>Mem {memoryMb.toFixed(1)}M</span>
          </>
        ) : null}
      </div>
      <div className="cad-studio__statusbar-right">
        <span>{runnerLabel}</span>
        <span>{workspace}</span>
        <span>Engine: {engine}</span>
      </div>
    </footer>
  );
}
