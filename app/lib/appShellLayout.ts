/** Activity/agent panel layout prefs + resize math (Wave 2 E1). */

/** Agent Sam chat column width bounds (px). */
export const AGENT_PANEL_MIN_W = 320;
export const AGENT_PANEL_MAX_W = 640;
/** Minimum width kept for the main editor/workspace while dragging the agent column. */
export const MAIN_MIN_W_FOR_AGENT_RESIZE = 380;
/** Wider pointer target than the visible 1px stroke for the agent column resizer (matches JSX). */
export const AGENT_RESIZER_HIT_PX = 10;
/** Wider hit target for the activity-sidebar grab (matches JSX). */
export const ACTIVITY_SIDEBAR_GRAB_PX = 10;
export const LS_ACTIVITY_PANEL_W = 'iam_activity_panel_w';
export const DEFAULT_ACTIVITY_PANEL_W = 260;
export const LS_EDITOR_PREVIEW_SPLIT_PCT = 'iam_editor_preview_split_pct';
export const EDITOR_PREVIEW_SPLIT_MIN = 20;
export const EDITOR_PREVIEW_SPLIT_MAX = 80;
export const DEFAULT_EDITOR_PREVIEW_SPLIT_PCT = 50;
export const EDITOR_PREVIEW_PANEL_MIN_PX = 220;
export const LS_MOBILE_ACTIVITY_PANEL_VH = 'iam_mobile_activity_panel_vh';
export const MOBILE_ACTIVITY_PANEL_MIN_VH = 28;
export const MOBILE_ACTIVITY_PANEL_MAX_VH = 75;
export const MOBILE_ACTIVITY_PANEL_DEFAULT_VH = 35;

export function readMobileActivityPanelVh(): number {
  try {
    const n = Number(sessionStorage.getItem(LS_MOBILE_ACTIVITY_PANEL_VH));
    if (Number.isFinite(n) && n >= MOBILE_ACTIVITY_PANEL_MIN_VH && n <= MOBILE_ACTIVITY_PANEL_MAX_VH) {
      return Math.round(n * 10) / 10;
    }
  } catch {
    /* ignore */
  }
  return MOBILE_ACTIVITY_PANEL_DEFAULT_VH;
}

export function readActivityPanelW(): number {
  try {
    const raw = localStorage.getItem(LS_ACTIVITY_PANEL_W);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 180 && n <= 480) return Math.round(n);
  } catch {
    /* ignore */
  }
  return DEFAULT_ACTIVITY_PANEL_W;
}

export function readEditorPreviewSplitPct(): number {
  try {
    const raw = localStorage.getItem(LS_EDITOR_PREVIEW_SPLIT_PCT);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= EDITOR_PREVIEW_SPLIT_MIN && n <= EDITOR_PREVIEW_SPLIT_MAX) {
      return Math.round(n * 10) / 10;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_EDITOR_PREVIEW_SPLIT_PCT;
}

/**
 * Next width after a horizontal drag.
 * Handle always sits between the panel and main:
 * - docked left  → drag right widens (+delta)
 * - docked right → drag right narrows (−delta)
 */
export function getNextPanelWidth(args: {
  startWidth: number;
  deltaX: number;
  /** Screen edge the panel is docked to (Files or Chat). */
  dock: 'left' | 'right';
  min: number;
  max: number;
}): number {
  const raw =
    args.dock === 'left' ? args.startWidth + args.deltaX : args.startWidth - args.deltaX;
  return Math.max(args.min, Math.min(args.max, Math.round(raw)));
}

export function activityRailWidthPx(expanded: boolean): number {
  return expanded ? 180 : 48;
}

/** Max agent column width so main workspace stays usable (also capped by AGENT_PANEL_MAX_W). */
export function getAgentPanelViewportMaxPx(opts: {
  viewportInnerWidth: number;
  activityRailWidth: number;
  activityPanelOpen: boolean;
  activityPanelWidth: number;
  mainMinWidth: number;
}): number {
  const activityStrip = opts.activityPanelOpen ? opts.activityPanelWidth + ACTIVITY_SIDEBAR_GRAB_PX : 0;
  const reserved =
    opts.activityRailWidth + activityStrip + AGENT_RESIZER_HIT_PX + opts.mainMinWidth;
  return opts.viewportInnerWidth - reserved;
}
