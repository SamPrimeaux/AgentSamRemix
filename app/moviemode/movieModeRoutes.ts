/** Reserved path segments under /dashboard/moviemode — not project ids. */
export const MOVIEMODE_RESERVED_SLUGS = ['templates', 'ai-studio', 'projects'] as const;

export type MovieModeShellTab = 'editor' | 'templates' | 'ai-studio' | 'projects';

export type ParsedMovieModeRoute = {
  tab: MovieModeShellTab;
  projectId: string | null;
};

export function isMovieModeProjectId(value: string | null | undefined): value is string {
  if (!value) return false;
  return !MOVIEMODE_RESERVED_SLUGS.includes(value as (typeof MOVIEMODE_RESERVED_SLUGS)[number]);
}

export function parseMovieModeRoute(pathname: string): ParsedMovieModeRoute {
  const base = '/dashboard/moviemode';
  if (pathname === base || pathname === `${base}/`) {
    return { tab: 'editor', projectId: null };
  }
  if (!pathname.startsWith(`${base}/`)) {
    return { tab: 'editor', projectId: null };
  }
  const segment = decodeURIComponent(pathname.slice(base.length + 1).split('/')[0] || '');
  if (segment === 'templates') return { tab: 'templates', projectId: null };
  if (segment === 'ai-studio') return { tab: 'ai-studio', projectId: null };
  if (segment === 'projects') return { tab: 'projects', projectId: null };
  return { tab: 'editor', projectId: segment || null };
}

export function movieModeTabPath(tab: MovieModeShellTab, projectId?: string | null): string {
  if (tab === 'editor') {
    return projectId && isMovieModeProjectId(projectId)
      ? `/dashboard/moviemode/${encodeURIComponent(projectId)}`
      : '/dashboard/moviemode';
  }
  if (tab === 'templates') return '/dashboard/moviemode/templates';
  if (tab === 'ai-studio') return '/dashboard/moviemode/ai-studio';
  return '/dashboard/moviemode/projects';
}

export const IAM_LOGO_URL =
  'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/ac515729-af6b-4ea5-8b10-e581a4d02100/thumbnail';
