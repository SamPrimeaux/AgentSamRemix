/**
 * App-layer sudo policy — must mirror /etc/sudoers.d/agentsam-ops on iam-tunnel.
 * Only /usr/local/sbin/iam-ops-* wrappers may be invoked via sudo on guarded exec paths.
 */

/** One segment (no && || |) that uses sudo must match this. */
export const SUDO_WRAPPER_RE =
  /^sudo\s+\/usr\/local\/sbin\/iam-ops-(systemctl|apt|cloudflared|workspace)(\s+.+)?$/i;

/**
 * @param {string} cmd
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkSudoPolicy(cmd) {
  if (!/\bsudo\b/i.test(cmd)) {
    return { ok: true };
  }

  // Block privilege escalation patterns regardless of wrapper path.
  const escalation = [
    /\bsudo\s+-[uSgH]/i,
    /\bsudo\s+--(?:user|group|login)=/i,
    /\bsudo\s+su\b/i,
    /\bsudo\s+\/bin\/(?:ba)?sh\b/i,
    /\bsudo\s+\/usr\/bin\/(?:ba)?sh\b/i,
  ];
  for (const pattern of escalation) {
    if (pattern.test(cmd)) {
      return { ok: false, reason: "blocked: sudo privilege escalation not permitted" };
    }
  }

  const segments = cmd.split(/\s*(?:&&|\|\||\||;)\s*/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || !/\bsudo\b/i.test(trimmed)) continue;
    if (!SUDO_WRAPPER_RE.test(trimmed)) {
      return {
        ok: false,
        reason: "blocked: sudo only permitted for /usr/local/sbin/iam-ops-* wrappers",
      };
    }
  }

  return { ok: true };
}
