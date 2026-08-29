/** Resolve in-app deep link for a notification / push payload. */

export type NotificationDeepLinkInput = {
  entityType?: string | null;
  entityId?: string | null;
  data?: unknown;
  href?: string | null;
  url?: string | null;
  fallback?: string;
};

function parseData(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function resolveNotificationDeepLink(input: NotificationDeepLinkInput): string {
  const fallback = String(input.fallback || '/dashboard/agent').trim() || '/dashboard/agent';
  const data = parseData(input.data);

  const fromFields = [input.href, input.url, data?.url, data?.href]
    .map((v) => (v != null ? String(v).trim() : ''))
    .find(Boolean);
  if (fromFields) {
    return fromFields.startsWith('/') ? fromFields : fallback;
  }

  const entityType = String(input.entityType || data?.entityType || data?.entity_type || '')
    .trim()
    .toLowerCase();
  const entityId = String(input.entityId || data?.entityId || data?.entity_id || '').trim();

  if (entityType === 'conversation' && entityId) {
    if (String(data?.type || '').toLowerCase() === 'phone_loop') {
      return `/dashboard/mail?folder=sent&c=${encodeURIComponent(entityId)}`;
    }
    return `/dashboard/agent/${encodeURIComponent(entityId)}`;
  }
  if (
    (entityType === 'email' ||
      entityType === 'received_email' ||
      entityType === 'mail' ||
      entityType === 'inbox') &&
    entityId
  ) {
    const conv =
      data?.conversationId != null
        ? String(data.conversationId).trim()
        : data?.conversation_id != null
          ? String(data.conversation_id).trim()
          : '';
    if (String(data?.type || '').toLowerCase() === 'phone_loop' || conv) {
      const q = new URLSearchParams();
      q.set('email', entityId);
      q.set('folder', 'sent');
      if (conv) q.set('c', conv);
      return `/dashboard/mail?${q.toString()}`;
    }
    return `/dashboard/mail?email=${encodeURIComponent(entityId)}&folder=inbox`;
  }
  if (entityType === 'deploy' || entityType === 'deployment') {
    return '/dashboard/settings/ci-cd';
  }

  return fallback;
}

/** Path + search only (for React Router navigate). */
export function toRouterPath(absoluteOrPath: string): string {
  const raw = String(absoluteOrPath || '').trim();
  if (!raw) return '/dashboard/agent';
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const u = new URL(raw);
      return `${u.pathname}${u.search}${u.hash}` || '/dashboard/agent';
    }
  } catch {
    /* ignore */
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export const IAM_PUSH_NAVIGATE = 'IAM_PUSH_NAVIGATE';
export const IAM_PUSH_RECEIVED = 'IAM_PUSH_RECEIVED';
export const IAM_OPEN_STATUS_NOTIF = 'iam-open-status-notification';
