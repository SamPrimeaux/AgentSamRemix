/**
 * GitHub /user/repos list scoping for dashboard + agent surfaces.
 * Drops org-wide read visibility (organization_member) and platform operator repos
 * for accounts that are not the platform owner.
 *
 * GitHub owners for repo filtering come from user_oauth_tokens for the tunnel owner —
 * never hardcode owner logins in this module.
 */

export const GITHUB_USER_REPOS_AFFILIATION = 'owner,collaborator';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseOwnerFromRepo(repo) {
  const ownerLogin = trim(repo?.owner?.login);
  if (ownerLogin) return ownerLogin.toLowerCase();
  const full = trim(repo?.full_name);
  if (!full.includes('/')) return '';
  return full.slice(0, full.indexOf('/')).trim().toLowerCase();
}

function hasWriteCollaboration(repo) {
  const perms = repo?.permissions || {};
  return !!(perms.push || perms.admin || perms.maintain);
}

/**
 * @param {unknown[]} repos
 * @param {string} userLogin — connected GitHub account login
 * @param {{ allowPlatformRepos?: boolean, platformOwners?: Set<string>|string[]|null }} [opts]
 * @returns {unknown[]}
 */
export function filterGithubReposListForUser(repos, userLogin, opts = {}) {
  const login = trim(userLogin).toLowerCase();
  if (!login || !Array.isArray(repos)) return [];
  if (opts.allowPlatformRepos === true) return repos;

  const owners = new Set();
  if (opts.platformOwners instanceof Set) {
    for (const o of opts.platformOwners) {
      const x = trim(o).toLowerCase();
      if (x) owners.add(x);
    }
  } else if (Array.isArray(opts.platformOwners)) {
    for (const o of opts.platformOwners) {
      const x = trim(o).toLowerCase();
      if (x) owners.add(x);
    }
  }

  return repos.filter((repo) => {
    const owner = parseOwnerFromRepo(repo);
    if (!owner) return false;

    if (owner === login) return true;

    if (owners.size && owners.has(owner)) return false;

    return hasWriteCollaboration(repo);
  });
}

/**
 * @param {any} env
 * @param {unknown[]} repos
 * @param {string} userLogin
 * @param {{ allowPlatformRepos?: boolean }} [opts]
 */
export async function filterGithubReposListForUserAsync(env, repos, userLogin, opts = {}) {
  if (opts.allowPlatformRepos === true) {
    return filterGithubReposListForUser(repos, userLogin, { allowPlatformRepos: true });
  }
  let platformOwners = null;
  try {
    const { loadIamTunnelOwnerConfig } = await import('../../backend/identity/workspace/tunnel-owner.js');
    const cfg = await loadIamTunnelOwnerConfig(env);
    platformOwners = cfg?.githubOwners || null;
  } catch {
    platformOwners = null;
  }
  return filterGithubReposListForUser(repos, userLogin, { ...opts, platformOwners });
}
