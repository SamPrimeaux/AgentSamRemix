/** Keep the installed PWA's OS badge aligned with unread dashboard work. */

type AppBadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function syncIamAppBadge(unreadCount: number): void {
  if (typeof navigator === 'undefined') return;

  const badgeNavigator = navigator as AppBadgeNavigator;
  if (typeof badgeNavigator.setAppBadge !== 'function') return;

  const count = Math.max(0, Math.floor(Number(unreadCount) || 0));
  try {
    const operation =
      count > 0
        ? badgeNavigator.setAppBadge(count)
        : typeof badgeNavigator.clearAppBadge === 'function'
          ? badgeNavigator.clearAppBadge()
          : badgeNavigator.setAppBadge(0);
    void Promise.resolve(operation).catch(() => undefined);
  } catch {
    /* App Badging is an optional browser capability. */
  }
}
