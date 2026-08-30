/**
 * Browser workbench peel manifest — app/components/BrowserView.tsx → app/agentsam/frontend/workbench/browser
 * **Not** exported from index.ts — delete when peel debt is zero.
 *
 * @module app/agentsam/frontend/workbench/browser/peel-manifest
 */

/** @typedef {'live'|'peel_target'|'in_progress'|'deleted'} PeelStatus */

/**
 * @type {readonly { id: string, status: PeelStatus, canonical: string, legacy: string, notes?: string }[]}
 */
export const BROWSER_PEEL_MANIFEST = Object.freeze([
  { id: 'types', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/types.ts', legacy: 'app/components/BrowserView.tsx (inline)' },
  { id: 'browser_api', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/browserApi.ts', legacy: 'app/components/BrowserView.tsx (inline fetch)' },
  { id: 'trust_gate', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/TrustGate.tsx', legacy: 'app/components/BrowserView.tsx PermissionGate' },
  { id: 'browser_toolbar', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/BrowserToolbar.tsx', legacy: 'app/components/BrowserView.tsx toolbar block' },
  { id: 'browser_surface', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/BrowserSurface.tsx', legacy: 'app/components/BrowserView.tsx BlockedPage + DevTools dock' },
  { id: 'element_picker', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/useElementPicker.ts + elementPickerScripts.ts', legacy: 'app/components/BrowserView.tsx picker runtime' },
  { id: 'design_mode_overlay', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/useDesignMode.ts + DesignModeOverlay.tsx', legacy: 'app/components/BrowserView.tsx design mode + annotate' },
  {
    id: 'browser_session',
    status: 'live',
    canonical: 'app/agentsam/frontend/workbench/browser/useBrowserSession.ts',
    legacy: 'app/components/BrowserView.tsx BrowserPane session block',
  },
  { id: 'browser_pane', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/BrowserPane.tsx', legacy: 'app/components/BrowserView.tsx BrowserPane' },
  { id: 'browser_workbench', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/BrowserWorkbench.tsx', legacy: 'app/components/BrowserView.tsx root split' },
  { id: 'live_timeline', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/BrowserLiveTimeline.tsx', legacy: 'app/components/BrowserLiveTimeline.tsx' },
  { id: 'live_ws', status: 'live', canonical: 'app/agentsam/frontend/workbench/browser/useAgentLiveBrowserWs.ts', legacy: 'app/hooks/useAgentLiveBrowserWs.ts' },
  { id: 'dashboard_mount', status: 'live', canonical: 'app/components/BrowserView.tsx (re-export)', legacy: 'app/components/BrowserView.tsx (~2787 lines)' },
  {
    id: 'browser_session_id',
    status: 'live',
    canonical: 'browser_session_id (bsess_*) → BROWSER_SESSION DO key; DO-only auth (user_id on ensure)',
    legacy: 'agent_run_id as DO key + SESSION_CACHE KV fallback',
    notes: 'No D1 agentsam_browser_session — see INTEGRATION.md',
  },
]);

/** @param {string} id */
export function browserPeelEntry(id) {
  return BROWSER_PEEL_MANIFEST.find((e) => e.id === id) ?? null;
}

export function browserPendingPeelTargets() {
  return BROWSER_PEEL_MANIFEST.filter((e) => e.status === 'peel_target' || e.status === 'in_progress');
}
