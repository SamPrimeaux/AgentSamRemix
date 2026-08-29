import { lazy, Suspense, type ReactNode } from 'react';
import { useCadJobPoll } from '../hooks/useCadJobPoll';
import { resolveCadJobPhase } from './cadJobPhase';
import { useActiveCadJobSelection } from './useActiveCadJobSelection';

const InlineJobProgress = lazy(() =>
  import('./InlineJobProgress').then((m) => ({ default: m.InlineJobProgress })),
);

export type InlineCadJobProgressLiveProps = {
  jobId?: string | null;
  /** When no jobId, auto-select an active job from D1. */
  autoSelect?: boolean;
  preferTerminal?: boolean;
  compact?: boolean;
  pollRealtime?: boolean;
  showJobPicker?: boolean;
  className?: string;
};

export function InlineCadJobProgressLive({
  jobId: jobIdProp,
  autoSelect = true,
  preferTerminal = false,
  compact = false,
  pollRealtime = true,
  showJobPicker = true,
  className = '',
}: InlineCadJobProgressLiveProps): ReactNode {
  const selection = useActiveCadJobSelection({
    preferTerminal,
    enabled: autoSelect && !jobIdProp,
  });
  const jobId = jobIdProp ?? (autoSelect ? selection.jobId : null);

  const { job, polling } = useCadJobPoll(jobId, {
    enabled: Boolean(jobId),
    realtime: pollRealtime,
    engine: jobIdProp ? undefined : selection.activeJob?.engine,
  });

  const phase = resolveCadJobPhase(job);
  const activeJobs = selection.jobs.filter((j) =>
    ['pending', 'queued', 'accepted', 'running'].includes(String(j.status || '').toLowerCase()),
  );

  if (!jobId) {
    return (
      <div className={`inline-cad-live inline-cad-live--idle ${className}`.trim()}>
        <p className="inline-cad-live__hint">No active CAD job — start one from Design Studio or Agent Sam.</p>
      </div>
    );
  }

  if (!phase) {
    return (
      <div className={`inline-cad-live inline-cad-live--idle ${className}`.trim()}>
        <p className="inline-cad-live__hint">{polling ? 'Loading job…' : 'Waiting for job data…'}</p>
      </div>
    );
  }

  return (
    <div className={`inline-cad-live ${className}`.trim()} data-polling={polling ? '1' : '0'}>
      {showJobPicker && !jobIdProp && activeJobs.length > 1 ? (
        <label className="inline-cad-live__picker">
          <span className="inline-cad-live__picker-label">Job</span>
          <select
            className="inline-cad-live__select"
            value={jobId}
            onChange={(e) => selection.setJobId(e.target.value)}
          >
            {activeJobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.engine} · {j.status} · {j.progress_pct ?? 0}%
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <Suspense fallback={<div className="inline-cad-live__hint">Loading progress…</div>}>
        <InlineJobProgress phase={phase} compact={compact} />
      </Suspense>
      <div className="inline-cad-live__meta">
        <span className="inline-cad-live__job" title={jobId}>
          {job?.engine || 'cad'} · {String(job?.status || 'running')}
        </span>
        {polling ? <span className="inline-cad-live__live">live</span> : null}
      </div>
    </div>
  );
}
