/**
 * Live CAD/Meshy progress inside a chat tool trace row (same hook as template library).
 */
import React, { useEffect } from 'react';
import { InlineCadJobProgressLive } from '../../designstudio/shared/InlineCadJobProgressLive';
import { useCadJobPoll } from '../../designstudio/hooks/useCadJobPoll';
import type { CadJobRow } from '../../designstudio/api';

export type ToolTraceCadLivePanelProps = {
  jobId: string;
  engineHint?: string;
  onTerminal?: (job: CadJobRow) => void;
};

export const ToolTraceCadLivePanel: React.FC<ToolTraceCadLivePanelProps> = ({
  jobId,
  engineHint,
  onTerminal,
}) => {
  const { job } = useCadJobPoll(jobId, {
    enabled: Boolean(jobId),
    realtime: true,
    engine: engineHint,
    onDone: onTerminal,
    onFailed: onTerminal,
  });

  useEffect(() => {
    const st = String(job?.status || '').toLowerCase();
    if (job && (st === 'done' || st === 'complete' || st === 'failed' || st === 'cancelled')) {
      onTerminal?.(job);
    }
  }, [job, onTerminal]);

  return (
    <div className="tool-trace-cad-live mt-2">
      <InlineCadJobProgressLive
        jobId={jobId}
        autoSelect={false}
        showJobPicker={false}
        pollRealtime
        compact
      />
    </div>
  );
};
