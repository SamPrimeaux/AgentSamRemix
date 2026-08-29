/**
 * Settings HTTP identity boundary — single IdentityContext per request.
 */
import { identityContextFromAuthContext } from '../../identity/contracts/identity-context.js';
import { userFromAuthContext as authContextToLegacyUser } from '../../identity/resolve-identity.js';

export function settingsIdentityFromHandoff(handoff) {
  const identity = identityContextFromAuthContext(handoff?.authCtx ?? null);
  const authUser =
    handoff?.authUser ??
    (handoff?.authCtx ? authContextToLegacyUser(handoff.authCtx) : null);
  return { identity, authUser };
}

export function settingsRequiresAuth(identity) {
  return Boolean(identity?.authenticated && identity.user?.id);
}
