import {
  emptyIdentityContext,
} from './contracts/identity-context.js';

/**
 * Convert the current SDK session into the portable application identity.
 *
 * This adapter is intentionally the only place that understands the
 * Agent Sam SDK session shape.
 */
export function identityContextFromSdkSession(session) {
  const user = session?.user;

  if (!user?.id) {
    return emptyIdentityContext();
  }

  return {
    authenticated: true,
    authType: 'session',
    sessionId:
      session?.id ??
      session?.sessionId ??
      session?.session_id ??
      null,

    user: {
      id: String(user.id),
      personId:
        user.person_uuid ??
        user.personUuid ??
        null,
      email: user.email ?? null,
      displayName:
        user.display_name ??
        user.displayName ??
        user.name ??
        null,
    },

    tenant: {
      id:
        user.tenant_id ??
        user.tenantId ??
        session?.tenant_id ??
        session?.tenantId ??
        null,
    },

    workspace: {
      id:
        session?.workspace_id ??
        session?.workspaceId ??
        null,

      storedActiveId:
        user.active_workspace_id ??
        user.activeWorkspaceId ??
        null,
    },

    membership: null,

    // Authorization is deliberately NOT inferred from the session.
    capabilities: {
      canRunPty: false,
      canRunMcp: false,
      canDeploy: false,
    },
  };
}
