import { useCallback, useEffect, useState } from 'react';
import type { MovieModeTimeline } from '../src/types/moviemode';
import { createEmptyTimeline } from '../moviemode/createEmptyTimeline';

type MoviemodeProject = {
  id: string;
  slug: string;
  title: string;
  r2_prefix?: string;
};

type UseMovieModeProjectOptions = {
  projectId?: string | null;
};

export function useMovieModeProject(opts: UseMovieModeProjectOptions = {}) {
  const [project, setProject] = useState<MoviemodeProject | null>(null);
  const [timeline, setTimeline] = useState<MovieModeTimeline | null>(null);
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (opts.projectId) {
        const res = await fetch(`/api/moviemode/projects/${encodeURIComponent(opts.projectId)}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = (await res.json()) as { project?: MoviemodeProject };
          setProject(data.project || null);
        }
        const tlRes = await fetch(
          `/api/moviemode/timelines?project_id=${encodeURIComponent(opts.projectId)}`,
          { credentials: 'include' },
        );
        if (tlRes.ok) {
          const tlData = (await tlRes.json()) as {
            timelines?: Array<{ id: string; timeline_json?: string | MovieModeTimeline }>;
          };
          const first = tlData.timelines?.[0];
          if (first) {
            setTimelineId(first.id);
            const parsed =
              typeof first.timeline_json === 'string'
                ? (JSON.parse(first.timeline_json || '{}') as MovieModeTimeline)
                : (first.timeline_json as MovieModeTimeline);
            setTimeline(parsed?.version ? parsed : createEmptyTimeline());
          } else {
            setTimeline(createEmptyTimeline());
          }
        } else {
          setTimeline(createEmptyTimeline());
        }
      } else {
        const sessionRes = await fetch('/api/moviemode/sessions', { credentials: 'include' });
        if (sessionRes.ok) {
          const data = (await sessionRes.json()) as {
            session?: MovieModeTimeline & { clips?: unknown[]; overlays?: unknown[] };
          };
          const s = data.session;
          if (s?.version === 1 && Array.isArray(s.tracks)) {
            setTimeline(s);
          } else {
            setTimeline(createEmptyTimeline());
          }
        } else {
          setTimeline(createEmptyTimeline());
        }
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setTimeline(createEmptyTimeline());
    } finally {
      setLoading(false);
    }
  }, [opts.projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveTimeline = useCallback(
    async (next: MovieModeTimeline) => {
      setTimeline(next);
      setSaving(true);
      try {
        if (timelineId) {
          await fetch(`/api/moviemode/timelines/${encodeURIComponent(timelineId)}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeline_json: next }),
          });
        } else if (project?.id) {
          const res = await fetch('/api/moviemode/timelines', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: project.id, timeline_json: next }),
          });
          const data = (await res.json()) as { id?: string };
          if (data.id) setTimelineId(data.id);
        }
        await fetch('/api/moviemode/sessions', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session: next,
            project_id: project?.id || opts.projectId || null,
          }),
        });
      } catch {
        /* autosave best-effort */
      } finally {
        setSaving(false);
      }
    },
    [timelineId, project?.id, opts.projectId],
  );

  return {
    project,
    timeline,
    loading,
    error,
    saving,
    setTimeline: saveTimeline,
    reload: load,
  };
}
