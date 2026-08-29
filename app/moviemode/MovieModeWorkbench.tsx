import React from 'react';
import { MovieModeMediaPanel } from './MovieModeMediaPanel';
import { MovieModeStudio } from './MovieModeStudio';
import type { MovieModeTimeline } from './types';

export type MovieModeWorkbenchProps = {
  projectId?: string | null;
  projectSlug?: string | null;
  timeline: MovieModeTimeline | null;
  onTimelineChange: (t: MovieModeTimeline) => void;
};

export function MovieModeWorkbench({
  projectId,
  projectSlug,
  timeline,
  onTimelineChange,
}: MovieModeWorkbenchProps) {
  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
      {/* Top area: media bin + preview side by side */}
      <div className="flex flex-1 min-h-0 overflow-hidden max-phone:flex-col">
        {/* Media column */}
        <aside
          className="shrink-0 border-r border-[var(--dashboard-border)] flex flex-col min-h-0 overflow-hidden bg-[var(--dashboard-panel)] max-phone:border-r-0 max-phone:border-b max-phone:shrink"
          style={{ width: 'min(420px, 38vw)' }}
        >
          <MovieModeMediaPanel
            projectId={projectId}
            projectSlug={projectSlug}
          />
        </aside>
        {/* Preview + timeline column */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <MovieModeStudio
            timeline={timeline}
            onTimelineChange={onTimelineChange}
          />
        </div>
      </div>
    </div>
  );
}
