/* Web Push display — imported by Workbox-generated /sw.js */

function resolvePushTargetUrl(raw) {
  const fallback = '/dashboard/mail';
  try {
    return new URL(String(raw || fallback), self.location.origin).href;
  } catch (_) {
    return new URL(fallback, self.location.origin).href;
  }
}

async function notifyOpenClients(notificationId) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  await Promise.all(
    clients
      .filter((client) => String(client.url || '').startsWith(self.location.origin))
      .map((client) => {
        try {
          client.postMessage({ type: 'IAM_PUSH_RECEIVED', notificationId: notificationId || null });
        } catch (_) {
          /* ignore */
        }
      }),
  );
}

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Inner Animal Media',
    body: '',
    url: '/dashboard/mail',
    tag: 'iam',
    notificationId: null,
    entityType: null,
    entityId: null,
    actions: [],
    actionTokens: {},
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          title: parsed.title || payload.title,
          body: parsed.body || '',
          url: parsed.url || payload.url,
          tag: parsed.tag || payload.tag,
          notificationId: parsed.notificationId || parsed.notification_id || null,
          entityType: parsed.entityType || parsed.entity_type || null,
          entityId: parsed.entityId || parsed.entity_id || null,
          actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 2) : [],
          actionTokens:
            parsed.actionTokens && typeof parsed.actionTokens === 'object'
              ? parsed.actionTokens
              : {},
        };
      }
    }
  } catch (_) {
    /* show default notification */
  }

  const showOpts = {
    body: payload.body,
    tag: payload.tag,
    data: {
      url: payload.url,
      notificationId: payload.notificationId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      actionTokens: payload.actionTokens || {},
    },
    icon: '/static/dashboard/app/pwa/icon-192.png',
    badge: '/static/dashboard/app/pwa/icon-192.png',
  };
  if (payload.actions.length) {
    showOpts.actions = payload.actions.map((a) => ({
      action: String(a.action || '').slice(0, 32),
      title: String(a.title || a.action || 'Go').slice(0, 40),
    }));
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, showOpts),
      notifyOpenClients(payload.notificationId),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const targetUrl = resolvePushTargetUrl(data.url || '/dashboard/agent');
  const notificationId = data.notificationId || null;
  const action = String(event.action || '').trim();
  const actionTokens = data.actionTokens && typeof data.actionTokens === 'object' ? data.actionTokens : {};
  const actionToken = action && actionTokens[action] ? String(actionTokens[action]) : '';

  event.waitUntil(
    (async () => {
      // Actionable button → POST sealed instruction into Agent Sam turn.
      if (action && actionToken) {
        try {
          await fetch(new URL('/api/push/action', self.location.origin).href, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              token: actionToken,
              action,
              notificationId,
            }),
            credentials: 'include',
          });
        } catch (_) {
          /* still open the conversation UI */
        }
      }

      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const origin = self.location.origin;

      for (const client of windowClients) {
        if (!String(client.url || '').startsWith(origin)) continue;

        try {
          if (typeof client.navigate === 'function') {
            await client.navigate(targetUrl);
          }
        } catch (_) {
          /* fall through to postMessage */
        }

        try {
          client.postMessage({
            type: 'IAM_PUSH_NAVIGATE',
            url: targetUrl,
            notificationId,
            action: action || null,
          });
        } catch (_) {
          /* ignore */
        }

        if (typeof client.focus === 'function') {
          await client.focus();
        }
        return;
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
