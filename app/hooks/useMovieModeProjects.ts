import { useCallback, useEffect, useState } from 'react';

export type MoviemodeProjectRow = {
  id: string;
  slug: string;
  title: string;
  updated_at?: string;
  created_at?: string;
  r2_prefix?: string;
};

export function useMovieModeProjects(enabled = true) {
  const [projects, setProjects] = useState<MoviemodeProjectRow[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/moviemode/projects', { credentials: 'include' });
      if (!res.ok) throw new Error(`Projects ${res.status}`);
      const data = (await res.json()) as { projects?: MoviemodeProjectRow[] };
      setProjects(data.projects || []);
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createProject = useCallback(async (title?: string) => {
    const now = new Date();
    const stamp = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const slug = `${stamp}-${Date.now().toString(36).slice(-4)}`;
    const res = await fetch('/api/moviemode/projects', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title: title?.trim() || slug }),
    });
    const data = (await res.json()) as { ok?: boolean; id?: string; error?: string };
    if (!data.ok || !data.id) throw new Error(data.error || 'Could not create project');
    await reload();
    return data.id;
  }, [reload]);

  return { projects, loading, error, reload, createProject };
}
