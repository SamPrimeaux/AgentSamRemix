/** Stable memory key builders for daily_evolution_curator. */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** @param {string} workspaceId @param {string} dateIso Chicago YYYY-MM-DD */
export function evolutionMemoryKey(workspaceId, dateIso) {
  return `evolution:${trim(workspaceId)}:${trim(dateIso)}`;
}

/** Per-workspace compass key (follows gcp_vm_self_heal_router_v1 naming). */
export function platformContextRouterKey(workspaceId) {
  const ws = trim(workspaceId);
  return ws ? `platform_context_router_v1:${ws}` : 'platform_context_router_v1';
}

export const DAILY_EVOLUTION_SOURCE = 'daily_evolution_curator';
export const HOT_WINDOW_DAYS = 14;
