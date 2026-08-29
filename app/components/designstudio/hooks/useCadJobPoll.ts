import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCadJob, pollMeshyStatus, type CadJobRow } from '../api';

const TERMINAL = new Set(['done', 'complete', 'failed', 'cancelled']);

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 15_000);
}

const REALTIME_POLL_MS = 1200;

export function useCadJobPoll(
  jobId: string | null,
  options?: {
    enabled?: boolean;
    engine?: string;
    /** Fixed ~1.2s polling while job is active (UI progress bars). Default false uses exponential backoff. */
    realtime?: boolean;
    onDone?: (job: CadJobRow) => void;
    onFailed?: (job: CadJobRow) => void;
  },
) {
  const [job, setJob] = useState<CadJobRow | null>(null);
  const [polling, setPolling] = useState(false);
  const attemptRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pollOnce = useCallback(async () => {
    if (!jobId) return;
    setPolling(true);
    try {
      let row: CadJobRow;
      let engine = options?.engine;
      if (!engine) {
        try {
          const meta = await fetchCadJob(jobId);
          engine = meta.engine;
          setJob(meta);
        } catch {
          engine = undefined;
        }
      }
      if (engine === 'meshy') {
        const meshy = await pollMeshyStatus(jobId);
        row = {
          id: meshy.job_id,
          engine: 'meshy',
          status: meshy.status,
          progress_pct: meshy.progress_pct ?? meshy.progress,
          public_url: meshy.public_url,
          task_type: meshy.task_type,
          model_formats: meshy.model_formats,
          texture_data: meshy.texture_data,
        };
      } else if (engine) {
        row = await fetchCadJob(jobId);
      } else {
        try {
          row = await pollMeshyStatus(jobId).then((meshy) => ({
            id: meshy.job_id,
            engine: 'meshy',
            status: meshy.status,
            progress_pct: meshy.progress_pct ?? meshy.progress,
            public_url: meshy.public_url,
            task_type: meshy.task_type,
            model_formats: meshy.model_formats,
            texture_data: meshy.texture_data,
          }));
        } catch {
          row = await fetchCadJob(jobId);
        }
      }
      setJob(row);
      const status = String(row.status || '').toLowerCase();
      if (TERMINAL.has(status)) {
        clearTimer();
        setPolling(false);
        if (status === 'done' || status === 'complete') {
          options?.onDone?.(row);
        } else if (row.status === 'failed') {
          options?.onFailed?.(row);
        }
        return;
      }
      const delay = options?.realtime ? REALTIME_POLL_MS : backoffMs(attemptRef.current++);
      timerRef.current = window.setTimeout(() => void pollOnce(), delay);
    } catch (e) {
      console.warn('[useCadJobPoll]', e);
      const delay = options?.realtime ? REALTIME_POLL_MS : backoffMs(attemptRef.current++);
      timerRef.current = window.setTimeout(() => void pollOnce(), delay);
    }
  }, [jobId, options, clearTimer]);

  useEffect(() => {
    attemptRef.current = 0;
    clearTimer();
    if (!jobId || options?.enabled === false) {
      setPolling(false);
      return;
    }
    void pollOnce();
    return clearTimer;
  }, [jobId, options?.enabled, pollOnce, clearTimer]);

  return { job, polling, refresh: pollOnce };
}
