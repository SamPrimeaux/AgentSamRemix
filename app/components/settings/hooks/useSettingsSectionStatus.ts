import { useCallback, useEffect, useState } from 'react';
import type { SettingsResponse } from '../components/SectionPrimitives';

export type UseSettingsSectionStatusArgs = {
  endpoint: string;
  workspaceId?: string | null;
  enabled?: boolean;
};

export function useSettingsSectionStatus<T = unknown>({
  endpoint,
  workspaceId,
  enabled = true,
}: UseSettingsSectionStatusArgs): {
  data: SettingsResponse<T> | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<SettingsResponse<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const ws = workspaceId?.trim();
      const url = ws ? `${endpoint}?workspace_id=${encodeURIComponent(ws)}` : endpoint;
      const r = await fetch(url, { credentials: 'same-origin' });
      const j = (await r.json().catch(() => ({}))) as SettingsResponse<T> & { error?: string };
      if (!r.ok || j.ok === false) {
        throw new Error(typeof j.error === 'string' ? j.error : `Load failed (${r.status})`);
      }
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load section');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [endpoint, workspaceId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}
