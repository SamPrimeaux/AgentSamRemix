import { useEffect, useState, useCallback } from 'react';
import { bootstrapSupabaseFromSession, getSupabaseClient } from '../lib/supabase';

export interface PlanTask {
  id: string;
  plan_id: string;
  order_index: number;
  title: string;
  description: string | null;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  category: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'blocked' | 'skipped' | 'carried';
  blocked_reason: string | null;
  notes: string | null;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  completed_at: string | null;
}

export function usePlanTasksRealtime(planId: string | null) {
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!planId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/agentsam/plans/${encodeURIComponent(planId)}/tasks`, {
        credentials: 'same-origin',
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as { tasks?: PlanTask[] };
      setTasks((data.tasks ?? []) as PlanTask[]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    let cancelled = false;
    let removeChannel: (() => void) | null = null;
    void (async () => {
      await fetchTasks();
      if (cancelled || !planId) return;

      const sb = getSupabaseClient() ?? (await bootstrapSupabaseFromSession());
      if (!sb) return;

      const channel = sb
        .channel(`plan_tasks:${planId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'agentsam_plan_tasks',
            filter: `plan_id=eq.${planId}`,
          },
          () => {
            void fetchTasks();
          },
        )
        .subscribe();

      removeChannel = () => {
        void sb.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      removeChannel?.();
    };
  }, [planId, fetchTasks]);

  return { tasks, loading, error, refetch: fetchTasks };
}
