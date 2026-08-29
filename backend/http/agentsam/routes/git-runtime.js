/**
 * Shared GitHub OAuth token resolution for Workers API routes (user-scoped only).
 */
import { getUserGithubToken } from '../../../../src/integrations/github.js';
import { resolveIntegrationUserId } from '../../../integrations/user-id.js';

/**
 * @param {{ id: string, email?: string|null }} authUser
 * @param {any} env
 * @param {string} [providerAccountId] — GitHub `account_identifier` / `?account=` login
 */
export async function resolveGitHubToken(authUser, env, providerAccountId = '') {
  const userId = await resolveIntegrationUserId(env, authUser);
  if (!userId || !env?.DB) {
    return { error: 'No GitHub token. Re-authenticate via GitHub OAuth.', status: 401 };
  }

  const row = await getUserGithubToken(env, userId, providerAccountId);
  if (!row?.token) {
    return { error: 'No GitHub token. Re-authenticate via GitHub OAuth.', status: 401 };
  }

  return { token: row.token, account_identifier: row.account_identifier || '' };
}
