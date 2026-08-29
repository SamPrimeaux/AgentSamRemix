import { useCallback, useEffect, useState } from 'react';
import type { AgentHomeCmsConfig } from '../../types/agentHomeScene';
import { DEFAULT_AGENT_HOME_CMS } from '../../types/agentHomeScene';

export type AgentHomeSceneSource = 'default' | 'user' | 'workspace' | 'theme';

export function useAgentHomeScene() {
  const [config, setConfig] = useState<AgentHomeCmsConfig>(DEFAULT_AGENT_HOME_CMS);
  const [source, setSource] = useState<AgentHomeSceneSource>('default');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/scene', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`scene_fetch_${res.status}`);
      const body = (await res.json()) as {
        cms?: AgentHomeCmsConfig;
        source?: AgentHomeSceneSource;
      };
      if (body.cms?.version === 1) setConfig(body.cms);
      if (body.source) setSource(body.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'scene_fetch_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persist = useCallback(async (next: AgentHomeCmsConfig) => {
    const res = await fetch('/api/agent/scene', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: next }),
    });
    if (!res.ok) throw new Error(`scene_save_${res.status}`);
    const body = (await res.json()) as {
      cms?: AgentHomeCmsConfig;
      source?: AgentHomeSceneSource;
    };
    if (body.cms?.version === 1) setConfig(body.cms);
    if (body.source) setSource(body.source);
    return body;
  }, []);

  return { config, source, loading, error, refresh, persist, setConfig };
}
