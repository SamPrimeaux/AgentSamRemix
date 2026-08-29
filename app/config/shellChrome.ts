/**
 * Dashboard chrome visibility — status bar, mobile nav offsets.
 * Create surfaces (Design Studio, CMS, Movie Mode, …) hide the dev status lip.
 */
import { isAgentEditorPath, normalizePath } from '../lib/agentRoutes';
import { SHELL_PRODUCTS } from './shellNav';

export const PREF_SHOW_STATUS_BAR = 'iam_pref_show_status_bar';
export const SHELL_PREF_CHANGE_EVENT = 'iam-shell-pref-change';

export function notifyShellPrefChange(key: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SHELL_PREF_CHANGE_EVENT, { detail: { key } }));
}

export function readShellBoolPref(key: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const v = localStorage.getItem(key);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch {
    /* ignore */
  }
  return defaultValue;
}

/** Agent editor with an open file — repo/branch chrome is meaningful here. */
export function isAgentEditorDevContext(pathname: string, hasActiveFile: boolean): boolean {
  return isAgentEditorPath(normalizePath(pathname)) && hasActiveFile;
}

/** Routes under the Create product menu — no git/notifications status bar. */
export function isCreateSurfaceRoute(pathname: string): boolean {
  const create = SHELL_PRODUCTS.find((p) => p.id === 'create');
  if (!create) return false;
  for (const item of create.items) {
    const path = item.path;
    if (!path) continue;
    if (item.match === 'exact') {
      if (pathname === path) return true;
    } else if (pathname === path || pathname.startsWith(`${path}/`)) {
      return true;
    }
  }
  return false;
}

/** Dev status lip (git, tunnel, PTY) — Agent editor only when a file is open. */
export function showDashboardStatusBar(
  pathname: string,
  opts?: { editorDevContext?: boolean; userPrefShow?: boolean },
): boolean {
  if (opts?.userPrefShow === false) return false;
  if (!isAgentEditorPath(normalizePath(pathname))) return false;
  return opts?.editorDevContext === true;
}

/**
 * Full IDE topbar (Cmd+K search, terminal, globe, more menu).
 * Product surfaces (Images, CMS, …) keep hamburger + workspace + agent toggle only.
 */
export function showFullIdeTopbar(pathname: string): boolean {
  return isAgentEditorPath(normalizePath(pathname));
}

/** Fixed dashboard status lip height (matches StatusBar row). */
export const DASHBOARD_STATUS_BAR_INSET = '1.5rem';

/** Bottom padding for floating chat composer — clears status bar + safe area. */
export function dashboardComposerBottomPad(_pathname: string, _isNarrow: boolean, extraPx = 16): string {
  return `calc(var(--iam-status-bar-inset, 0px) + env(safe-area-inset-bottom, 0px) + ${extraPx}px)`;
}

/** Fixed mobile tab bar sits above the 1.5rem StatusBar when visible.
 * Kept for Movie Mode / legacy callers — primary shell no longer mounts a tab bar.
 */
export const MOBILE_TAB_BAR_BOTTOM_WITH_STATUS =
  'calc(1.5rem + env(safe-area-inset-bottom, 0px))';

export const MOBILE_TAB_BAR_BOTTOM_FLUSH = 'env(safe-area-inset-bottom, 0px)';

export function mobileTabBarBottomOffset(showStatusBar: boolean): string {
  return showStatusBar ? MOBILE_TAB_BAR_BOTTOM_WITH_STATUS : MOBILE_TAB_BAR_BOTTOM_FLUSH;
}

/** Chrome topbar content row (h-10) + iOS status-bar inset for fixed overlays. */
export const MOBILE_CHROME_TOP_OFFSET =
  'calc(2.5rem + env(safe-area-inset-top, 0px))';
