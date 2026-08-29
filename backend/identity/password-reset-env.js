/**
 * Password reset service factory — no oauth-finalize import (avoids auth ↔ worker-boot cycle).
 */
import { createIamPasswordResetService } from './password-reset.js';
import { hashPassword } from '../auth/password-crypto.js';
import { resolveAuthUserLookup } from './users/index.js';

/** @param {Record<string, unknown>} env */
export function createIamPasswordResetServiceForEnv(env) {
  return createIamPasswordResetService(env, {
    findEligibleUser: (email) => resolveAuthUserLookup(env, email),
    hashPassword,
  });
}
