/**
 * Host cwd resolution — local Mac/Windows paths vs GCP iam-tunnel sparse clones.
 *
 * Local: workspace_settings.workspace_root on user_hosted_tunnel.
 * Remote (platform_vm): prefer resolveIdentityScopedGcpCwd.
 *   settings.vm_workspace_root when set; never ambient invent for unresolved callers.
 * ExecOS runtime home: resolveIamGcpExecosHome(env) from D1 (PM2 only — not a project repo).
 */

import {
  resolveIamGcpExecosHome,
  resolveIamGcpPlatformRepo,
} from '../../../backend/identity/workspace/tunnel-owner.js';

export {
  resolveIamGcpExecosHome,
  resolveIamGcpPlatformRepo,
};

/** @deprecated Prefer resolveIamGcpExecosHome(env) — paths are D1-only. */
export const IAM_GCP_EXECOS_HOME = null;
/** @deprecated Prefer resolveIamGcpPlatformRepo(env) */
export const IAM_GCP_PLATFORM_REPO_INNERANIMALMEDIA = null;
/** @deprecated */
export const IAM_GCP_OPERATOR_REPO = null;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * GCP remote lane cwd from workspace settings. Fail loud when unset — never invent
 * the platform repo path (use resolveIdentityScopedGcpCwd for identity-aware defaults).
 * @param {Record<string, unknown>|null|undefined} [settings]
 * @returns {string|null}
 */
export function gcpRemoteExecCwd(settings = null) {
  if (settings && typeof settings === 'object') {
    const fromVm = trim(settings.vm_workspace_root || settings.repo?.vm_path);
    if (fromVm) return fromVm;
  }
  return null;
}

/**
 * @deprecated Prefer gcpRemoteExecCwd(settings). Never invent a path from Mac roots.
 * @param {string} [_root]
 * @param {Record<string, unknown>|null} [settings]
 */
export function translateHostRootForGcp(_root, settings = null) {
  return gcpRemoteExecCwd(settings);
}

/**
 * @param {Record<string, unknown>|null|undefined} settings
 * @returns {string|null}
 */
export function vmWorkspaceRootFromSettings(settings) {
  return gcpRemoteExecCwd(settings);
}

/**
 * @param {Record<string, unknown>|null|undefined} settings
 */
export function vmWorkspaceCdCommandFromSettings(settings) {
  const root = vmWorkspaceRootFromSettings(settings);
  return root ? `cd ${root}` : '';
}

/** @param {string} p */
export function isForeignDesktopAbsolutePath(p) {
  const s = trim(p);
  if (!s) return false;
  return s.startsWith('/Users/') || s.startsWith('/Volumes/') || /^[A-Za-z]:\\/.test(s);
}

/**
 * Collect Mac/Windows absolute path tokens embedded in a shell command.
 * Skips URL schemes (https://Users.…) by requiring a path boundary before /.
 * @param {string} command
 * @returns {string[]}
 */
export function findForeignDesktopAbsolutePaths(command) {
  const cmd = String(command || '');
  if (!cmd) return [];
  const found = [];
  const re =
    /(?:^|[\s"'=`(:,])((?:\/Users\/|\/Volumes\/)[^\s"'`;|&<>()]+|[A-Za-z]:\\[^\s"'`;|&<>()]+)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    const p = trim(m[1]).replace(/[,;.]+$/, '');
    if (p && isForeignDesktopAbsolutePath(p)) found.push(p);
  }
  return [...new Set(found)];
}

/**
 * Map one Mac/Windows absolute path onto gcpRoot when possible.
 * Prefer settings.workspace_root prefix; else same trailing leaf as gcpRoot.
 * Never invent /home/$user/$rest from arbitrary /Users paths.
 *
 * @param {string} macPath
 * @param {string} gcpRoot
 * @param {{ settings?: Record<string, unknown>|null, macRoots?: string[] }} [opts]
 * @returns {string|null}
 */
export function mapForeignDesktopPathToGcp(macPath, gcpRoot, opts = {}) {
  const foreign = trim(macPath);
  const root = trim(gcpRoot).replace(/\/+$/, '');
  if (!foreign || !root || !isForeignDesktopAbsolutePath(foreign)) return null;

  const settings = opts.settings && typeof opts.settings === 'object' ? opts.settings : null;
  /** @type {string[]} */
  const macRoots = [];
  if (Array.isArray(opts.macRoots)) {
    for (const r of opts.macRoots) {
      const t = trim(r).replace(/\/+$/, '');
      if (t) macRoots.push(t);
    }
  }
  const wsRoot = trim(settings?.workspace_root).replace(/\/+$/, '');
  if (wsRoot && isForeignDesktopAbsolutePath(wsRoot)) macRoots.push(wsRoot);

  for (const macRoot of macRoots) {
    if (foreign === macRoot) return root;
    if (foreign.startsWith(`${macRoot}/`)) return `${root}${foreign.slice(macRoot.length)}`;
  }

  const leaf = root.split('/').filter(Boolean).pop();
  if (!leaf) return null;
  const leafRe = new RegExp(`^(?:/Users/[^/]+|/Volumes/[^/]+)/${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/.*)?$`);
  const hit = foreign.match(leafRe);
  if (hit) return `${root}${hit[1] || ''}`;

  // Windows C:\Users\…\<leaf>\…
  const winLeafRe = new RegExp(
    `^[A-Za-z]:\\\\(?:Users|users)\\\\[^\\\\]+\\\\${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\\\.*)?$`,
    'i',
  );
  const winHit = foreign.match(winLeafRe);
  if (winHit) {
    const rest = winHit[1] ? winHit[1].replace(/\\/g, '/') : '';
    return `${root}${rest}`;
  }

  return null;
}

/**
 * Strip leading Mac `cd /Users/... &&` and rewrite/reject embedded Mac|Windows paths
 * for Linux GCP exec hosts.
 *
 * @param {string} command
 * @param {string} gcpRoot
 * @param {{
 *   settings?: Record<string, unknown>|null,
 *   macRoots?: string[],
 *   rejectUnmapped?: boolean,
 *   requireRoot?: boolean,
 *   executionScope?: 'repository'|'host'|string,
 * }} [opts]
 * @returns {{ ok: boolean, command: string, rewritten: { from: string, to: string }[], rejected_paths: string[], error?: string, user_message?: string }}
 */
export function sanitizeShellCommandForGcpExec(command, gcpRoot, opts = {}) {
  const root = trim(gcpRoot);
  let cmd = trim(command);
  /** @type {{ from: string, to: string }[]} */
  const rewritten = [];
  if (!cmd) {
    return { ok: true, command: cmd, rewritten, rejected_paths: [] };
  }
  if (!root) {
    if (opts.requireRoot === true) {
      return {
        ok: false,
        command: cmd,
        rewritten,
        rejected_paths: [],
        error: 'gcp_checkout_root_required',
        user_message:
          'Repository-scoped GCP exec requires a verified checkout root on the selected host. ' +
          'Set or verify the remote checkout path, use GitHub tools, or use the sandbox lane.',
      };
    }
    return { ok: true, command: cmd, rewritten, rejected_paths: [] };
  }

  const m = cmd.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*&&\s*(.+)$/is);
  if (m) {
    const dir = trim(m[1] || m[2] || m[3]);
    const rest = trim(m[4]);
    if (isForeignDesktopAbsolutePath(dir)) {
      const quoted = root.includes(' ') ? `"${root.replace(/"/g, '\\"')}"` : root;
      rewritten.push({ from: dir, to: root });
      cmd = `cd ${quoted} && ${rest}`;
    }
  }

  const embedded = findForeignDesktopAbsolutePaths(cmd);
  /** @type {string[]} */
  const rejected = [];
  for (const foreign of embedded) {
    const mapped = mapForeignDesktopPathToGcp(foreign, root, opts);
    if (!mapped) {
      rejected.push(foreign);
      continue;
    }
    if (mapped === foreign) continue;
    cmd = cmd.split(foreign).join(mapped);
    rewritten.push({ from: foreign, to: mapped });
  }

  const stillForeign = findForeignDesktopAbsolutePaths(cmd);
  for (const p of stillForeign) {
    if (!rejected.includes(p)) rejected.push(p);
  }

  const rejectUnmapped = opts.rejectUnmapped !== false;
  if (rejectUnmapped && rejected.length) {
    return {
      ok: false,
      command: cmd,
      rewritten,
      rejected_paths: rejected,
      error: 'embedded_mac_path_on_gcp',
      user_message:
        `Command embeds desktop-absolute path(s) that cannot run on the GCP cloud desk: ${rejected.join(', ')}. ` +
        `Use paths under ${root} (or relative paths after the harness cd). ` +
        `Do not pass /Users/... or /Volumes/... into agentsam_terminal_remote.`,
    };
  }

  return { ok: true, command: cmd, rewritten, rejected_paths: rejected };
}

/**
 * Strip Mac `cd /Users/... &&` prefixes for Linux exec hosts.
 * Also rewrites mappable embedded Mac paths; leaves unmapped paths in place
 * (prefer sanitizeShellCommandForGcpExec for fail-loud GCP wraps).
 * @param {string} command
 * @param {string} gcpRoot — required Linux root; if empty, command is left unchanged
 */
export function rewriteMacCwdInShellCommand(command, gcpRoot) {
  const out = sanitizeShellCommandForGcpExec(command, gcpRoot, { rejectUnmapped: false });
  return out.command;
}

/**
 * @param {{ platform?: string|null, target_type?: string|null, targetType?: string|null }} [connection]
 */
export function connectionUsesGcpRepoLayout(connection) {
  const platform = trim(connection?.platform).toLowerCase();
  const targetType = trim(connection?.target_type || connection?.targetType).toLowerCase();
  if (platform === 'linux') return true;
  if (targetType === 'platform_vm') return true;
  return false;
}

/**
 * Map macOS workspace_root to GCP vm root when target is platform_vm.
 * Returns null when vm_workspace_root is unset (fail loud).
 * @param {string|null|undefined} cwd
 * @param {{ platform?: string|null, target_type?: string|null, targetType?: string|null }} [connection]
 * @param {Record<string, unknown>|null|undefined} [settings]
 */
export function normalizeExecCwdForConnection(cwd, connection = null, settings = null) {
  const raw = trim(cwd);
  if (!connectionUsesGcpRepoLayout(connection)) {
    return raw || null;
  }
  if (!raw || raw.startsWith('/Users/') || raw.startsWith('/Volumes/')) {
    return gcpRemoteExecCwd(settings);
  }
  return raw;
}

/**
 * Local/user_hosted_tunnel: workspace_root.
 * GCP platform_vm: vm_workspace_root from settings (fail loud — no ambient platform repo).
 * @param {string|null|undefined} workspaceRoot
 * @param {{
 *   connection?: Record<string, unknown>|null,
 *   settings?: Record<string, unknown>|null,
 *   forceGcp?: boolean,
 * }} [ctx]
 */
export function resolveRepoRootForHost(workspaceRoot, ctx = {}) {
  const root = trim(workspaceRoot);
  const forceGcp = ctx.forceGcp === true || connectionUsesGcpRepoLayout(ctx.connection);
  if (forceGcp) {
    const vm = vmWorkspaceRootFromSettings(ctx.settings);
    if (vm) return vm;
    if (root && !root.startsWith('/Users/') && !/^[A-Za-z]:\\/.test(root) && !root.startsWith('/Volumes/')) {
      return root;
    }
    return null;
  }
  return root;
}
