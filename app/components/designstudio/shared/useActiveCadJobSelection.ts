import { useCallback, useEffect, useRef, useState } from 'react';
import { IAM_DESIGNSTUDIO_CAD_JOB } from '@/agentChatConstants';
import { fetchCadJobs, type CadJobRow } from '@/components/designstudio/api';

const ACTIVE = new Set(['pending', 'queued', 'accepted', 'running']);

function pickActiveJob(jobs: CadJobRow[], preferTerminal: boolean): CadJobRow | null {
  const active = jobs.filter((j) => ACTIVE.has(String(j.status || '').toLowerCase()));
  if (!active.length) return null;
  if (preferTerminal) {
    const terminal = active.find((j) =>
      ['openscad', 'blender', 'freecad'].includes(String(j.engine || '').toLowerCase()),
    );
    if (terminal) return terminal;
  } else {
    const meshy = active.find((j) => String(j.engine || '').toLowerCase() === 'meshy');
    if (meshy) return meshy;
  }
  return active[0];
}

export function useActiveCadJobSelection(opts?: { preferTerminal?: boolean; enabled?: boolean }) {
  const preferTerminal = opts?.preferTerminal ?? false;
  const enabled = opts?.enabled !== false;
  const [jobs, setJobs] = useState<CadJobRow[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const list = await fetchCadJobs(25);
      setJobs(list);
      setJobId((prev) => {
        if (prev && list.some((j) => j.id === prev)) return prev;
        return pickActiveJob(list, preferTerminal)?.id ?? null;
      });
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [enabled, preferTerminal]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onCadJob = (e: Event) => {
      const id = (e as CustomEvent<{ job_id?: string }>).detail?.job_id;
      if (id) {
        setJobId(id);
        void refresh();
      }
    };
    window.addEventListener(IAM_DESIGNSTUDIO_CAD_JOB, onCadJob);
    return () => window.removeEventListener(IAM_DESIGNSTUDIO_CAD_JOB, onCadJob);
  }, [refresh]);

  const activeJob = jobs.find((j) => j.id === jobId) ?? pickActiveJob(jobs, preferTerminal);

  return { jobId: jobId ?? activeJob?.id ?? null, setJobId, jobs, activeJob, loading, refresh };
}
