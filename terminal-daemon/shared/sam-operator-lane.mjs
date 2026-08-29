/**
 * Operator-repo cwd gate — path prefixes only.
 *
 * Who may use those prefixes is attested by the Worker after D1
 * (X-IAM-Operator-Cwd: 1). ExecOS must not keep an au_* allowlist.
 *
 * Connor / tenant sessions stay under IAM_WORKSPACES_ROOT (/workspace/…).
 */

/** @param {string|null|undefined} raw */
function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function samOperatorRepoPrefixes(env = process.env) {
  const fromEnv = parseCsv(env.SAM_OPERATOR_REPO_PATHS);
  if (fromEnv.length) return fromEnv;
  const home = String(env.HOME || "").trim();
  if (process.platform === "darwin" && home) return [`${home}/inneranimalmedia`];
  return [];
}

/** @param {string|null|undefined} cwd */
export function cwdUnderSamOperatorRepo(cwd, env = process.env) {
  const p = String(cwd || "").replace(/\/+$/, "");
  if (!p) return false;
  return samOperatorRepoPrefixes(env).some(
    (prefix) => prefix && (p === prefix || p.startsWith(`${prefix}/`)),
  );
}

function operatorCwdAttested(req) {
  return String(req?.headers?.["x-iam-operator-cwd"] || "").trim() === "1";
}

/**
 * Fail-closed when cwd is an operator git clone unless Worker attested tunnel-owner.
 * @param {import('http').IncomingMessage} req
 * @param {string} cwd
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateSamOperatorRepoAccess(req, cwd, env = process.env) {
  if (!cwdUnderSamOperatorRepo(cwd, env)) return { ok: true };
  if (operatorCwdAttested(req)) return { ok: true };
  return {
    ok: false,
    reason:
      "operator repo requires authorizing tunnel-owner session (X-IAM-Operator-Cwd)",
  };
}
