import React from 'react';
import { EmptyTelemetryCard } from '../cards/EmptyTelemetryCard';

export default function CostsTab() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <EmptyTelemetryCard
        title="Cost Trend"
        dataSourceKey="costTrend"
        status="not_connected_yet"
        reason="Usage/cost tables exist, but cost aggregation endpoints are not connected to the Costs tab yet."
        suggestedAction="Expose /api/analytics/costs backed by agentsam_usage_events with rollup fallback."
      />
      <EmptyTelemetryCard
        title="Prompt Cache"
        dataSourceKey="promptCache"
        status="not_connected_yet"
        reason="Prompt cache key tracking exists in schema, but cache savings are not connected to the Costs tab yet."
        suggestedAction="Connect agentsam_prompt_cache_keys to a cache savings aggregation."
      />
    </div>
  );
}

