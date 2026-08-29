import React from 'react';
import { EmptyTelemetryCard } from '../cards/EmptyTelemetryCard';

export default function DeploysTab() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <EmptyTelemetryCard
        title="Deploy Health"
        dataSourceKey="deployHealth"
        status="not_connected_yet"
        reason="Deployment health telemetry tables exist, but deploy analytics endpoints are not connected yet."
        suggestedAction="Expose /api/analytics/deploys backed by agentsam_deployment_health."
      />
      <EmptyTelemetryCard
        title="Dashboard Versions"
        dataSourceKey="dashboardVersions"
        status="not_connected_yet"
        reason="Dashboard version history exists, but version reporting is not connected to analytics yet."
        suggestedAction="Expose /api/analytics/deploys/versions backed by dashboard_versions."
      />
    </div>
  );
}

