/** Scanner/probe rejection policy owned by the Worker front door. */

export function isLikelyWordPressProbePath(pathLower) {
  if (!pathLower || pathLower[0] !== '/') return false;
  const p = pathLower;
  if (p.startsWith('/wp-admin')) return true;
  if (p.startsWith('/wp-includes')) return true;
  if (p.startsWith('/wp-content')) return true;
  if (p.startsWith('/wp-json/')) return true;
  if (p === '/xmlrpc.php') return true;
  if (p === '/wp-login.php') return true;
  if (p.endsWith('/wlwmanifest.xml')) return true;
  if (p === '/readme.html' || p === '/license.txt') return true;
  return false;
}

export function isLikelySecretProbePath(pathLower) {
  if (!pathLower || pathLower[0] !== '/') return false;
  const p = pathLower;

  // .env and variants anywhere: /.env, /app/.env, /.env.bak, /.env.php.bak, /svelte/.env.local
  if (p.includes('/.env')) return true;

  // .git metadata
  if (p === '/.git' || p.endsWith('/.git') || p.includes('/.git/')) return true;

  // VCS leftovers scanners also hit
  if (p === '/.svn' || p.endsWith('/.svn') || p.includes('/.svn/')) return true;
  if (p === '/.hg' || p.endsWith('/.hg') || p.includes('/.hg/')) return true;

  const slash = p.lastIndexOf('/');
  const base = slash >= 0 ? p.slice(slash + 1) : p;

  // phpinfo anywhere in the basename (phpinfo.php, _phpinfo.php, phpinfo.php.bak, …)
  if (base.includes('phpinfo')) return true;

  // WordPress / PHP config dumps
  if (base.startsWith('wp-config.php')) return true;
  if (base === 'config.php.bak' || base === 'configuration.php.bak') return true;

  // Cloud / local credential files
  if (p === '/.aws/credentials' || p.endsWith('/.aws/credentials')) return true;
  if (p === '/aws/credentials' || p.endsWith('/aws/credentials')) return true;
  if (
    base === 'id_rsa' ||
    base === 'id_dsa' ||
    base === 'id_ecdsa' ||
    base === 'id_ed25519' ||
    base === 'id_rsa.pub'
  ) {
    return true;
  }
  if (base === '.htpasswd') return true;
  if (
    base === 'credentials.json' ||
    base === 'secrets.json' ||
    base === 'secret.json' ||
    base === 'secrets.yml' ||
    base === 'secrets.yaml'
  ) {
    return true;
  }

  // Common DB / site backup dumps scanners request by name
  if (
    /^(backup|dump|db|database|mysql|site|www|data)[._-].*\.(sql|sql\.gz|sql\.bz2|tar\.gz|zip)$/.test(
      base,
    ) ||
    /^(backup|dump|database|mysql)\.(sql|sql\.gz|tar\.gz|zip)$/.test(base)
  ) {
    return true;
  }

  return false;
}
