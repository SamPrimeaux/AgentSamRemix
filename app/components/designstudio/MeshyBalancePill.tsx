/** Live Meshy credit balance pill for Design Studio header. */
import React, { useCallback, useEffect, useState } from 'react';
import { Coins, Loader2 } from 'lucide-react';
import { fetchMeshyBalance } from './hooks/meshyBalance';

type Props = {
  className?: string;
  refreshKey?: number;
};

export const MeshyBalancePill: React.FC<Props> = ({ className = '', refreshKey = 0 }) => {
  const [balance, setBalance] = useState<number | null>(null);
  const [stub, setStub] = useState(false);
  const [keySource, setKeySource] = useState<'byok' | 'platform' | 'none' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMeshyBalance();
      if (data.stub) {
        setStub(true);
        setBalance(null);
        setKeySource(data.key_source ?? 'none');
      } else {
        setStub(false);
        setBalance(typeof data.balance === 'number' ? data.balance : null);
        setKeySource(data.key_source ?? 'platform');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Balance unavailable');
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [refresh, refreshKey]);

  const low = balance != null && balance < 15;

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      title={
        stub
          ? 'No Meshy key — add in Settings → Keys or configure platform MESHYAI_API_KEY'
          : error
            ? error
            : keySource === 'byok'
              ? 'Meshy credits (your key) — click to refresh'
              : 'Meshy credits (platform key) — click to refresh'
      }
      className={`pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold tabular-nums transition-colors ${
        low
          ? 'border-amber-500/35 bg-amber-500/10 text-amber-300'
          : 'border-white/[0.08] bg-white/[0.04] text-emerald-300'
      } ${className}`}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin opacity-70" />
      ) : (
        <Coins size={14} className={low ? 'text-amber-400' : 'text-cyan-400'} />
      )}
      <span className="hidden sm:inline">
        {stub
          ? 'No key'
          : error
            ? '—'
            : balance != null
              ? `${keySource === 'byok' ? 'BYOK · ' : ''}${balance.toLocaleString()} cr`
              : '—'}
      </span>
    </button>
  );
};
