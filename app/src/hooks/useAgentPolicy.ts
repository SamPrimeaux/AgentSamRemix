import { useState, useEffect } from 'react';
import { fetchAgentPolicy } from '../agentDomainFetch';

export function useAgentPolicy(workspaceId: string | null | undefined) {
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) {
      setPolicy(null);
      return;
    }

    setLoading(true);
    fetchAgentPolicy(workspaceId)
      .then(setPolicy)
      .catch(() => setPolicy(null))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  return { policy, loading };
}
