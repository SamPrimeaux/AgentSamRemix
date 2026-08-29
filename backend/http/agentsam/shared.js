/** Shared primitives for source-free Agent Sam HTTP routes. */

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

export function trustedUser(identity) {
  const user = identity?.authUser && typeof identity.authUser === 'object'
    ? identity.authUser
    : null;
  const userId = String(user?.id ?? identity?.userId ?? '').trim();
  if (!userId) return null;
  return {
    ...user,
    id: userId,
    tenant_id: String(user?.tenant_id ?? identity?.tenantId ?? '').trim() || null,
    email: user?.email != null ? String(user.email) : null,
  };
}

export function trustedScope(identity) {
  const user = trustedUser(identity);
  return {
    authUser: user,
    userId: String(user?.id ?? identity?.userId ?? '').trim() || null,
    tenantId: String(user?.tenant_id ?? identity?.tenantId ?? '').trim() || null,
    workspaceId: String(identity?.workspaceId ?? '').trim() || null,
    sessionId: String(identity?.sessionId ?? '').trim() || null,
  };
}
