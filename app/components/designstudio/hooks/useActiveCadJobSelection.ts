import { useCallback, useEffect, useMemo, useState } from 'react';
import { IAM_DESIGNSTUDIO_CAD_JOB } from '@/agentChatConstants';
import { fetchCadJobs, type CadJobRow } from '../api';

const ACTIVE = new Set(['pending', 'queued', 'accepted', 'running']);

function pickActiveJob(jobs: CadJobRow[], preferTerminal: boolean): CadJobRow | null {
  const terminalEngines = new Set(['openscad', 'blender', 'freecad']);
  const sorted = [...jobs].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  for (const j of sorted) {
    const st = String(j.status || '').toLowerCase();
    if (!ACTIVE.has(st)) continue;
    const eng = String(j.engine || '').toLowerCase();
    if (preferTerminal && terminalEngines.has(eng)) return j;
    if (!preferTerminal && eng === 'meshy') return j;
  }
  for (const j of sorted) {
    if (ACTIVE.has(String(j.status || '').toLowerCase())) return j;
  }
  return sorted[0] ?? null;
}

export function useActiveCadJobSelection(preferTerminal = true) {
  const [jobs, setJobs] = useState<CadJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [autoTrack, setAutoTrack] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchCadJobs(25);
      setJobs(list);
      if (autoTrack && !jobId) {
        const pick = pickActiveJob(list, preferTerminal);
        if (pick?.id) setJobId(pick.id);
      }
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [autoTrack, jobId, preferTerminal]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onCadJob = (e: Event) => {
      const detail = (e as CustomEvent<{ job_id?: string }>).detail;
      const id = detail?.job_id?.trim();
      if (!id) return;
      setJobId(id);
      setAutoTrack(true);
      void refresh();
    };
    window.addEventListener(IAM_DESIGNSTUDIO_CAD_JOB, onCadJob);
    return () => window.removeEventListener(IAM_DESIGNSTUDIO_CAD_JOB, onCadJob);
  }, [refresh]);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === jobId) ?? null,
    [jobs, jobId],
  );

  const selectJob = useCallback((id: string | null) => {
    setJobId(id);
    setAutoTrack(false);
  }, []);

  return {
    jobs,
    jobId,
    selectedJob,
    loading,
    refresh,
    selectJob,
    autoTrack,
  };
}
