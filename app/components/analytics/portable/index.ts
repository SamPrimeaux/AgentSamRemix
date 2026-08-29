/**
 * Portable analytics UI — synced from agentsam-cms-editor analytics-app.
 * Contract: docs/ANALYTICS_PORTABLE_CONTRACT.md
 */

export { KpiCard } from './kpi/KpiCard';
export { KpiGrid } from './kpi/KpiGrid';
export { ActivityLineChart } from './charts/ActivityLineChart';
export type { ActivityPoint } from './charts/ActivityLineChart';
export { SimpleTable } from './tables/SimpleTable';
export { fmtNumber, fmtUsd, fmtPct } from './format';
export type { PulsePortableInput, PortableKpiItem } from './types';
export {
  pulseToPortableKpis,
  pulseToActivityChart,
  pulseToLeaderboardRows,
} from './adapters/pulseToPortable';
export { OverviewPortablePanels } from './OverviewPortablePanels';
