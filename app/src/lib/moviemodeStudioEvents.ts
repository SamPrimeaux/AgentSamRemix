/**
 * MovieMode Studio ↔ Agent Sam bridge (window CustomEvents + session prefs).
 */

import type { MovieModeTimeline } from '../types/moviemode';
import { isPhoneViewport } from '../../lib/breakpoints';

export const IAM_MOVIEMODE_PANEL_TOGGLE = 'iam:moviemode-panel-toggle';
export const IAM_MOVIEMODE_SURFACE_CONTEXT = 'iam:moviemode-surface-context';
export const IAM_MOVIEMODE_RIGHT_PANEL_COLLAPSED = 'iam.moviemode.mediaBinCollapsed';

export type MovieModeSurfaceContext = {
  route: '/dashboard/moviemode';
  surface: 'moviemode';
  hasTimeline: boolean;
  clipCount: number;
  overlayCount: number;
  durationFrames: number;
  fps: number;
  width: number;
  height: number;
  mediaBinCollapsed: boolean;
};

export function readMovieModeRightPanelCollapsed(): boolean | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(IAM_MOVIEMODE_RIGHT_PANEL_COLLAPSED);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    /* ignore */
  }
  return null;
}

export function defaultMovieModeRightPanelCollapsed(): boolean {
  return isPhoneViewport();
}

export function persistMovieModeRightPanelCollapsed(collapsed: boolean): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(IAM_MOVIEMODE_RIGHT_PANEL_COLLAPSED, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function dispatchMovieModePanelToggle(collapsed?: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(IAM_MOVIEMODE_PANEL_TOGGLE, {
      detail: collapsed == null ? undefined : { collapsed },
    }),
  );
}

export function dispatchMovieModeSurfaceContext(
  timeline: MovieModeTimeline | null,
  rightPanelCollapsed: boolean,
): void {
  if (typeof window === 'undefined') return;
  const clipCount = timeline?.tracks?.reduce((n, t) => n + (t.clips?.length ?? 0), 0) ?? 0;
  const payload: MovieModeSurfaceContext = {
    route: '/dashboard/moviemode',
    surface: 'moviemode',
    hasTimeline: Boolean(timeline),
    clipCount,
    overlayCount: timeline?.overlays?.length ?? 0,
    durationFrames: timeline?.durationFrames ?? 0,
    fps: timeline?.fps ?? 30,
    width: timeline?.width ?? 1920,
    height: timeline?.height ?? 1080,
    mediaBinCollapsed: rightPanelCollapsed,
  };
  window.dispatchEvent(new CustomEvent(IAM_MOVIEMODE_SURFACE_CONTEXT, { detail: payload }));
}
