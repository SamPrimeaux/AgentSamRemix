/**
 * Daemon vs operator identity.
 * agentsam owns the ExecOS service. Development commands run as the pinned operator.
 *
 * Configuration may name the operator (EXECOS_OPERATOR_USER / EXECOS_OPERATOR_HOME).
 * Runtime must not invent a person. Operator is never taken from the HTTP body.
 */
import { exec, execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import { homedir, userInfo, hostname } from "os";
import { hostKindFromOs } from "./exec-vocabulary.js";

function trim(v) {
  return v == null ? "" : String(v).trim();
}

function daemonUsername() {
  try {
    return trim(userInfo().username);
  } catch {
    return trim(process.env.USER);
  }
}

/** Platform service principal (not a human operator). Override with EXECOS_SERVICE_USER. */
function serviceUsername() {
  return trim(process.env.EXECOS_SERVICE_USER) || "agentsam";
}

function lookupPasswd(user) {
  if (!user) return { uid: null, home: null };
  try {
    const line = execFileSync("getent", ["passwd", user], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const parts = line.split(":");
    const uid = Number(parts[2]);
    const home = trim(parts[5]);
    return {
      uid: Number.isFinite(uid) ? uid : null,
      home: home || null,
    };
  } catch {
    return { uid: null, home: null };
  }
}

export function operatorWrapperPath() {
  return trim(process.env.EXECOS_OPERATOR_WRAPPER) || "/usr/local/sbin/execos-run-as-operator";
}

/**
 * @returns {{
 *   daemon_username: string,
 *   effective_username: string,
 *   effective_uid: number|null,
 *   effective_home: string,
 *   needs_switch: boolean,
 *   operator_config_missing: boolean,
 *   hostname: string,
 *   os: string,
 *   wrapper: string,
 * }}
 */
export function resolveOperatorIdentity() {
  const daemon = daemonUsername();
  const fromEnv = trim(process.env.EXECOS_OPERATOR_USER);
  const wrapperInstalled = existsSync(operatorWrapperPath());
  const serviceDaemon = daemon === serviceUsername();
  const operatorConfigMissing = (wrapperInstalled || serviceDaemon) && !fromEnv;
  const operatorUser = fromEnv || (operatorConfigMissing ? "" : daemon);
  const passwd = lookupPasswd(operatorUser);
  const homeFromEnv = trim(process.env.EXECOS_OPERATOR_HOME);
  let operatorHome = homeFromEnv || passwd.home || "";
  if (!operatorHome && operatorUser === daemon) {
    try {
      operatorHome = trim(homedir()) || trim(process.env.HOME);
    } catch {
      operatorHome = trim(process.env.HOME);
    }
  }
  const needsSwitch =
    !operatorConfigMissing &&
    process.platform !== "win32" &&
    Boolean(fromEnv) &&
    Boolean(daemon) &&
    fromEnv !== daemon;
  let uid = passwd.uid;
  if (uid == null && !needsSwitch) {
    try {
      uid = userInfo().uid;
    } catch {
      uid = null;
    }
  }
  return {
    daemon_username: daemon,
    effective_username: operatorUser,
    effective_uid: uid,
    effective_home: operatorHome,
    needs_switch: needsSwitch,
    operator_config_missing: operatorConfigMissing,
    hostname: hostname(),
    os: process.platform,
    wrapper: operatorWrapperPath(),
  };
}

export function operatorExecEnv(baseEnv = {}) {
  const id = resolveOperatorIdentity();
  const env = { ...baseEnv };
  if (id.effective_home) env.HOME = id.effective_home;
  if (id.effective_username) {
    env.USER = id.effective_username;
    env.LOGNAME = id.effective_username;
    env.EXECOS_OPERATOR_USER = id.effective_username;
  }
  if (id.effective_home) env.EXECOS_OPERATOR_HOME = id.effective_home;
  return env;
}

export function operatorWrapperAvailable() {
  return existsSync(operatorWrapperPath());
}

function failOperator(code, message, cb) {
  const err = new Error(message);
  err.code = code;
  cb(err, "", message);
}

/**
 * Run a shell command as the pinned operator. Does not rewrite $HOME inside `cmd`.
 * @param {string} cmd
 * @param {string} cwd
 * @param {{ env?: NodeJS.ProcessEnv, timeout?: number, maxBuffer?: number }} opts
 * @param {(err: Error|null, stdout: string, stderr: string) => void} cb
 */
export function execAsOperator(cmd, cwd, opts, cb) {
  const id = resolveOperatorIdentity();
  if (id.operator_config_missing) {
    failOperator(
      "operator_user_required",
      "EXECOS_OPERATOR_USER is required when the daemon is the ExecOS service account (or the operator wrapper is installed). Runtime will not invent an operator account.",
      cb,
    );
    return;
  }
  if (id.needs_switch && !id.effective_username) {
    failOperator("operator_user_required", "EXECOS_OPERATOR_USER is required to impersonate the operator.", cb);
    return;
  }

  const env = operatorExecEnv({ ...(opts.env || {}) });
  const timeout = opts.timeout;
  const maxBuffer = opts.maxBuffer ?? 10 * 1024 * 1024;
  const common = { cwd, env, timeout, maxBuffer, killSignal: "SIGKILL" };

  if (!id.needs_switch) {
    exec(cmd, { ...common, shell: "/bin/bash" }, cb);
    return;
  }

  const wrapper = id.wrapper;
  if (!existsSync(wrapper)) {
    failOperator(
      "operator_wrapper_missing",
      `operator_wrapper_missing: ${wrapper} (install deploy/gcp/sbin/execos-run-as-operator)`,
      cb,
    );
    return;
  }

  // Node chdirs as the daemon before exec. The wrapper cds after the user switch.
  const spawnCwd = existsSync("/tmp") ? "/tmp" : process.cwd();
  execFile(
    "/usr/bin/sudo",
    ["-n", "-u", id.effective_username, "-H", "--", wrapper, "--cwd", cwd, "--", cmd],
    { ...common, cwd: spawnCwd },
    cb,
  );
}

/**
 * node-pty argv to open an operator login shell. Caller still sets cwd/env.
 * @returns {{ file: string, args: string[] }}
 */
export function operatorPtySpawnSpec(cwd) {
  const id = resolveOperatorIdentity();
  if (id.operator_config_missing || !id.needs_switch) {
    return { file: "/bin/bash", args: ["--login"] };
  }
  return {
    file: "/usr/bin/sudo",
    args: ["-n", "-u", id.effective_username, "-H", "--", id.wrapper, "--cwd", cwd, "--pty"],
  };
}

export function operatorRepoPath() {
  return trim(process.env.EXECOS_DEFAULT_CWD) || trim(process.env.IAM_GCP_OPERATOR_REPO);
}

/**
 * Cheap operator-shell probe (id / pwd / uname / hostname / HOME).
 * @param {(err: Error|null, stdout: string, stderr: string) => void} cb
 */
export function probeOperatorShell(cb) {
  const id = resolveOperatorIdentity();
  const cwd = id.effective_home || process.cwd();
  const cmd =
    'printf "user=%s\\nuid=%s\\nhome=%s\\npwd=%s\\nuname=%s\\nhostname=%s\\n" "$(id -un)" "$(id -u)" "$HOME" "$(pwd)" "$(uname -s)" "$(hostname -s 2>/dev/null || hostname)"';
  execAsOperator(cmd, cwd, { timeout: 8000, maxBuffer: 64 * 1024 }, cb);
}

/**
 * Cheap operator-repo probe as the effective operator user.
 * @param {(err: Error|null, stdout: string, stderr: string) => void} cb
 */
export function probeOperatorRepo(cb) {
  const repo = operatorRepoPath();
  if (!repo) {
    failOperator(
      "operator_repo_unconfigured",
      "EXECOS_DEFAULT_CWD or IAM_GCP_OPERATOR_REPO is required for /health/repo.",
      cb,
    );
    return;
  }
  const cmd =
    'git rev-parse --show-toplevel && git status -sb && (test -w .git && echo GIT_WRITABLE=1 || echo GIT_WRITABLE=0)';
  execAsOperator(cmd, repo, { timeout: 20000, maxBuffer: 256 * 1024 }, cb);
}

/**
 * Stamp identity fields that originate on this host (not invented by MCP).
 * @param {Record<string, unknown>} extra
 */
export function executionIdentityReceipt(extra = {}) {
  const id = resolveOperatorIdentity();
  return {
    hostname: id.hostname,
    os: id.os,
    host_kind: extra.host_kind || hostKindFromOs(id.os),
    daemon_username: id.daemon_username,
    effective_username: id.effective_username || null,
    effective_uid: id.effective_uid,
    effective_home: id.effective_home || null,
    operator_config_missing: id.operator_config_missing || undefined,
    ...extra,
  };
}
