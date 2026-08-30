import {
  SHELL_PRODUCTS,
  type ShellProductId,
  type ShellProductItem,
} from '../config/shellNav';
import {
  AGENT_HOME_PATH,
  AGENT_NEW_CHAT_PATH,
  isAgentConversationPath,
} from './agentRoutes';

export function normalizeDashboardPath(pathname: string): string {
  const raw = String(pathname || '').trim() || '/dashboard/agent';
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

export function pathMatches(pathname: string, path: string, match: 'exact' | 'prefix' = 'exact'): boolean {
  const p = normalizeDashboardPath(pathname);
  const target = normalizeDashboardPath(path);
  if (match === 'prefix') {
    return p === target || p.startsWith(`${target}/`);
  }
  return p === target;
}

export function isProductItemActive(pathname: string, item: ShellProductItem, search = ''): boolean {
  if (item.children?.length) {
    return item.children.some((child) => isProductItemActive(pathname, child, search));
  }
  if (!item.path) return false;
  const p = normalizeDashboardPath(pathname);
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const collabSeg = params.get('seg');
  const onCollaborate = pathMatches(p, '/dashboard/collaborate', 'exact');
  const onTicketsSeg = collabSeg === 'tickets' || collabSeg === 'tasks';
  // Collaborate Calendar vs Tickets share pathname — distinguish via ?seg=
  if (item.id === 'calendar') {
    return onCollaborate && !onTicketsSeg;
  }
  if (item.id === 'tickets') {
    return onCollaborate && onTicketsSeg;
  }
  // Media ▾ — Videos wins over Images for /dashboard/images/videos/*
  if (item.id === 'media-videos') {
    return pathMatches(p, '/dashboard/images/videos', 'prefix');
  }
  if (item.id === 'media-images') {
    if (!pathMatches(p, '/dashboard/images', 'prefix')) return false;
    return !pathMatches(p, '/dashboard/images/videos', 'prefix');
  }
  if (item.id === 'agent') {
    const onAgentSurface =
      pathMatches(pathname, AGENT_HOME_PATH, 'exact') ||
      pathMatches(pathname, AGENT_NEW_CHAT_PATH, 'exact') ||
      isAgentConversationPath(pathname);
    return onAgentSurface;
  }
  const pathOnly = item.path.split('?')[0] || item.path;
  return pathMatches(pathname, pathOnly, item.match ?? 'exact');
}

export function resolveActiveProduct(pathname: string): ShellProductId | null {
  const p = normalizeDashboardPath(pathname);
  // Prefer Media for any Hosted images / Videos path before Create/Code home matches.
  if (pathMatches(p, '/dashboard/images', 'prefix')) {
    return 'media';
  }
  // Code owns the whole Agent Sam surface (/agent, /new, /editor, conversations).
  if (p === AGENT_HOME_PATH || p.startsWith(`${AGENT_HOME_PATH}/`)) {
    return 'code';
  }
  for (const product of SHELL_PRODUCTS) {
    if (pathMatches(p, product.home, product.home.includes('agent') ? 'prefix' : 'exact')) {
      return product.id;
    }
    if (product.items.some((item) => isProductItemActive(p, item))) {
      return product.id;
    }
  }
  return null;
}

export function isCoreRouteActive(
  pathname: string,
  path: string,
  match: 'exact' | 'prefix' = 'exact',
): boolean {
  return pathMatches(pathname, path, match);
}
