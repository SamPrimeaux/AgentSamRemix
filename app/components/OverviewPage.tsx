/**
 * Re-exports the modular overview page (`./overview/index.tsx`).
 * Prefer `import OverviewPage from './overview'` for new code.
 */
export { default } from "./overview";
export { default as OverviewPage } from "./overview";
export type {
  ActivityData,
  AgentActivity,
  CostLatencyPoint,
  DashboardBundle,
  DeployData,
  KpiDef,
  KpiStripData,
  WorkflowData,
} from "./overview/types";
