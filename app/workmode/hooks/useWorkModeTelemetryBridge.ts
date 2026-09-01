import { useCallback, useEffect, useState } from 'react';
import type { TelemetryData } from '../lib/telemetry';
import { calculateCost } from '../lib/telemetry';

type AgentTelemetryPayload = {
  runs?: Array<{
    model?: string;
    latency_ms?: number;
    input_tokens?: number;
    output_tokens?: number;
  }>;
  totals?: {
    input_tokens?: number;
    output_tokens?: number;
    cost_usd?: number;
  };
};

/**
 * Polls /api/agent/telemetry and merges with locally captured Work Mode runs.
 */
export function useWorkModeTelemetryBridge(localEntries: TelemetryData[]) {
  const [remoteEntries, setRemoteEntries] = useState<TelemetryData[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/telemetry', { credentials: 'include' });
      if (!res.ok) return;
      const payload = (await res.json()) as AgentTelemetryPayload;
      const mapped: TelemetryData[] = (payload.runs || []).slice(0, 20).map((r) => ({
        latencyMs: r.latency_ms ?? 0,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        model: r.model ?? 'unknown',
        cost: calculateCost(r.model ?? 'unknown', r.input_tokens ?? 0, r.output_tokens ?? 0),
      }));
      setRemoteEntries(mapped);
    } catch {
      /* optional endpoint */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 120_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return [...localEntries, ...remoteEntries];
}
