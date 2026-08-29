import { useCallback, useEffect, useState } from 'react';
import type { ChatModelRow } from '../../components/ChatAssistant/types';
import {
  fetchAgentDefaultModel,
  fetchAgentModels,
  getCachedAgentModels,
  invalidateAgentDomainCache,
} from '../agentDomainFetch';

const MAX_EMPTY_RETRIES = 5;

export function useAgentModels(enabled: boolean) {
  // Hydrate from module cache immediately — ChatAssistant remounts (layout
  // center/rail/hidden) must not flash Auto-only while refetching.
  const [models, setModels] = useState<ChatModelRow[]>(() => getCachedAgentModels());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const reload = useCallback(() => {
    invalidateAgentDomainCache();
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Do not wipe a warm cache on transient sessionUserId=null flashes.
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const load = (attempt: number, revalidate: boolean) => {
      const warm = getCachedAgentModels();
      if (warm.length > 0) {
        // Paint cached rows immediately so remounts don't flash Auto-only…
        setModels(warm);
        setError(null);
        setLoading(false);
        // …but always revalidate once so D1 picker flips (e.g. Cursor trio) show up.
        if (!revalidate) return;
      } else {
        setLoading(true);
      }
      fetchAgentModels({ force: revalidate || warm.length === 0 })
        .then((rows) => {
          if (cancelled) return;
          setModels(rows);
          setError(null);
          if (rows.length === 0 && attempt < MAX_EMPTY_RETRIES) {
            invalidateAgentDomainCache();
            retryTimer = setTimeout(() => load(attempt + 1, true), 500 * (attempt + 1));
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err?.message ? String(err.message) : 'models_fetch_failed');
          if (attempt < MAX_EMPTY_RETRIES) {
            invalidateAgentDomainCache();
            retryTimer = setTimeout(() => load(attempt + 1, true), 500 * (attempt + 1));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    load(0, true);

    const onVisible = () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      // Revalidate when returning to the tab so catalog edits land without a full reload.
      load(0, true);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // models omitted from deps on purpose — visibility reads current via closure + cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retryNonce forces manual reload
  }, [enabled, retryNonce]);

  return { models, loading, error, reload };
}

export function useAgentDefaultModel(enabled: boolean) {
  const [defaultModelKey, setDefaultModelKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setDefaultModelKey(null);
      return;
    }
    setLoading(true);
    fetchAgentDefaultModel()
      .then(setDefaultModelKey)
      .catch(() => setDefaultModelKey(null))
      .finally(() => setLoading(false));
  }, [enabled]);

  return { defaultModelKey, loading };
}
