/**
 * Dashboard shell navigation — single source for sidebar + mobile drawer.
 * Phase 1: core rows, Media (Images/Videos), Code / Create / Collaborate product menus.
 */

export type ShellProductId = 'media' | 'code' | 'create' | 'collaborate';

export type ShellCoreItem =
  | { id: string; kind: 'action'; label: string; action: 'new-chat' | 'open-chats' }
  | { id: string; kind: 'route'; label: string; path: string; match?: 'exact' | 'prefix' };

export type ShellProductItem = {
  id: string;
  label: string;
  path?: string;
  match?: 'exact' | 'prefix';
  action?: 'movie-mode';
  /** Nested sub-nav (Shopify-style parent → children). */
  children?: ShellProductItem[];
};

/** CMS Suite — reusable library is active; authoring routes remain parked until their CMS API pass. */
export const CMS_SUITE_NAV: ShellProductItem[] = [
  // /dashboard/examples is reserved for the later CMS-owned Examples implementation.
  { id: 'cms-sites', label: 'Overview', path: '/dashboard/cms', match: 'exact' },
  { id: 'cms-online-store', label: 'Online store', path: '/dashboard/cms/online-store', match: 'prefix' },
  { id: 'cms-theme-editor', label: 'Theme editor', path: '/dashboard/cms/theme-editor', match: 'prefix' },
  { id: 'cms-editor', label: 'Pages', path: '/dashboard/cms/pages', match: 'prefix' },
  { id: 'cms-templates', label: 'Templates', path: '/dashboard/cms/templates', match: 'prefix' },
  { id: 'cms-imports', label: 'Imports', path: '/dashboard/cms/imports', match: 'prefix' },
];

/** Media ▾ — Images + Videos (promoted out of Create; sits below Work). */
export const MEDIA_NAV_CHILDREN: ShellProductItem[] = [
  // Active matching for media-images excludes /videos (see shellNavResolve).
  { id: 'media-images', label: 'Images', path: '/dashboard/images', match: 'prefix' },
  { id: 'media-videos', label: 'Videos', path: '/dashboard/images/videos', match: 'prefix' },
];

export type ShellProduct = {
  id: ShellProductId;
  label: string;
  home: string;
  items: ShellProductItem[];
};

export const SHELL_CORE_NAV: ShellCoreItem[] = [
  { id: 'home', kind: 'route', label: 'Home', path: '/dashboard/home', match: 'exact' },
  { id: 'new-chat', kind: 'action', label: 'New chat', action: 'new-chat' },
  { id: 'chats', kind: 'action', label: 'Chats', action: 'open-chats' },
  { id: 'projects', kind: 'route', label: 'Projects', path: '/dashboard/projects', match: 'prefix' },
  { id: 'artifacts', kind: 'route', label: 'Work', path: '/dashboard/artifacts', match: 'prefix' },
];

/** Rendered immediately under Work (before Code / Create / Collaborate). */
export const SHELL_MEDIA_PRODUCT: ShellProduct = {
  id: 'media',
  label: 'Media',
  home: '/dashboard/images/storage',
  items: MEDIA_NAV_CHILDREN,
};

export const SHELL_PRODUCTS: ShellProduct[] = [
  SHELL_MEDIA_PRODUCT,
  {
    id: 'code',
    label: 'Code',
    home: '/dashboard/agent/new',
    items: [
      { id: 'agent', label: 'Agent', path: '/dashboard/agent/new', match: 'exact' },
      { id: 'workflows', label: 'Workflows', path: '/dashboard/workflows', match: 'exact' },
      { id: 'database', label: 'Database', path: '/dashboard/database', match: 'exact' },
    ],
  },
  {
    id: 'create',
    label: 'Create',
    home: '/dashboard/designstudio',
    items: [
      { id: 'designstudio', label: 'Design Studio', path: '/dashboard/designstudio', match: 'exact' },
      { id: 'draw', label: 'Draw', path: '/dashboard/draw', match: 'exact' },
      {
        id: 'cms-suite',
        label: 'CMS Suite',
        path: '/dashboard/cms',
        match: 'prefix',
        children: CMS_SUITE_NAV,
      },
      { id: 'moviemode', label: 'Movie Mode', path: '/dashboard/moviemode', match: 'prefix' },
    ],
  },
  {
    id: 'collaborate',
    label: 'Collaborate',
    home: '/dashboard/collaborate',
    items: [
      { id: 'calendar', label: 'Calendar', path: '/dashboard/collaborate', match: 'exact' },
      { id: 'tickets', label: 'Tickets', path: '/dashboard/collaborate?seg=tickets', match: 'exact' },
      { id: 'mail', label: 'Mail', path: '/dashboard/mail', match: 'prefix' },
      { id: 'meet', label: 'Meet', path: '/dashboard/meet', match: 'prefix' },
      { id: 'learn', label: 'Learn', path: '/dashboard/learn', match: 'exact' },
    ],
  },
];

/** Legacy paths → canonical (router redirects). */
export const SHELL_ROUTE_ALIASES: Record<string, string> = {
  '/dashboard/library': '/dashboard/artifacts',
  '/dashboard/launch-desk': '/dashboard/collaborate',
  '/dashboard/calendar': '/dashboard/collaborate',
  '/dashboard/agent/examples': '/dashboard/examples',
};
