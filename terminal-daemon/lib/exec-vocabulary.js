/**
 * ExecOS vocabulary SSOT.
 *
 * Three different abstractions — do not treat them as interchangeable:
 *
 *   TERMINAL_LANE  user-facing Agent Sam tools:  local | remote | sandbox
 *   EXEC_TARGET    dispatcher hop *plane*:       local | remote | container | sandbox
 *   HOST_KIND      physical/runtime fact:        darwin | linux | cf_container
 *
 * `mac` and `gcp` are legacy/current-host aliases for the local and remote
 * planes. They remain accepted on the wire. They are not durable platform
 * concepts. Today's implementations are bound in configuration
 * (MAC_EXEC_URL / LOCAL_EXEC_URL, GCP_EXEC_URL / REMOTE_EXEC_URL).
 *
 * Wire fields:
 *   body.target / receipt.target           → EXEC_TARGET (canonical plane)
 *   requested_lane / resolved_lane         → TERMINAL_LANE
 *   host_kind                              → HOST_KIND
 *   hostname                               → origin identity, not a target
 */
export const EXEC_TARGET = Object.freeze({
  LOCAL: 'local',
  REMOTE: 'remote',
  CONTAINER: 'container',
  SANDBOX: 'sandbox',
});

/** @deprecated Current-host aliases. Prefer EXEC_TARGET.LOCAL / REMOTE. */
export const EXEC_TARGET_LEGACY = Object.freeze({
  MAC: 'mac',
  GCP: 'gcp',
});

export const TERMINAL_LANE = Object.freeze({
  LOCAL: 'local',
  REMOTE: 'remote',
  SANDBOX: 'sandbox',
});

export const HOST_KIND = Object.freeze({
  DARWIN: 'darwin',
  LINUX: 'linux',
  CF_CONTAINER: 'cf_container',
});

/** Host-backed hops whose cwd must match that host's filesystem shape. */
export const HOST_CWD_VALIDATED_TARGETS = new Set([EXEC_TARGET.LOCAL, EXEC_TARGET.REMOTE]);

const TARGET_ALIASES = Object.freeze({
  [EXEC_TARGET.LOCAL]: EXEC_TARGET.LOCAL,
  [EXEC_TARGET_LEGACY.MAC]: EXEC_TARGET.LOCAL,
  user_hosted_tunnel: EXEC_TARGET.LOCAL,
  user_local: EXEC_TARGET.LOCAL,
  [EXEC_TARGET.REMOTE]: EXEC_TARGET.REMOTE,
  [EXEC_TARGET_LEGACY.GCP]: EXEC_TARGET.REMOTE,
  platform_vm: EXEC_TARGET.REMOTE,
  'iam-tunnel': EXEC_TARGET.REMOTE,
  iam_tunnel: EXEC_TARGET.REMOTE,
  [EXEC_TARGET.CONTAINER]: EXEC_TARGET.CONTAINER,
  [EXEC_TARGET.SANDBOX]: EXEC_TARGET.SANDBOX,
});

const TARGET_TO_LANE = Object.freeze({
  [EXEC_TARGET.LOCAL]: TERMINAL_LANE.LOCAL,
  [EXEC_TARGET.REMOTE]: TERMINAL_LANE.REMOTE,
  [EXEC_TARGET.SANDBOX]: TERMINAL_LANE.SANDBOX,
  [EXEC_TARGET.CONTAINER]: TERMINAL_LANE.SANDBOX,
});

/**
 * Current filesystem/runtime kind for a plane.
 * Local is Darwin today; Remote is Linux today. That mapping lives here so
 * cwd validation can stay host-shaped without making Mac/GCP canonical targets.
 */
const PLANE_HOST_KIND = Object.freeze({
  [EXEC_TARGET.LOCAL]: HOST_KIND.DARWIN,
  [EXEC_TARGET.REMOTE]: HOST_KIND.LINUX,
  [EXEC_TARGET.CONTAINER]: HOST_KIND.CF_CONTAINER,
  [EXEC_TARGET.SANDBOX]: HOST_KIND.CF_CONTAINER,
});

function trimLower(value) {
  return String(value || '').trim().toLowerCase();
}

/** @returns {string|null} canonical EXEC_TARGET plane, or null if unknown */
export function resolveExecTarget(value) {
  const key = trimLower(value);
  return TARGET_ALIASES[key] || null;
}

export function hostKindForExecTarget(value) {
  const plane = resolveExecTarget(value);
  return plane ? PLANE_HOST_KIND[plane] || null : null;
}

export function hostKindFromOs(platform = process.platform) {
  const os = trimLower(platform);
  if (os === 'darwin') return HOST_KIND.DARWIN;
  if (os === 'linux') return HOST_KIND.LINUX;
  if (os === 'win32' || os === 'windows') return null;
  return os || null;
}

/** @returns {string|null} canonical TERMINAL_LANE for a plane or alias */
export function laneFromExecTarget(value) {
  const plane = resolveExecTarget(value) || trimLower(value);
  if (plane === TERMINAL_LANE.LOCAL || plane === TERMINAL_LANE.REMOTE || plane === TERMINAL_LANE.SANDBOX) {
    return plane;
  }
  return TARGET_TO_LANE[plane] || null;
}

/** Current-implementation map: this Darwin host is the local plane; else remote. */
export function hostTargetFromPlatform(platform = process.platform) {
  return platform === 'darwin' ? EXEC_TARGET.LOCAL : EXEC_TARGET.REMOTE;
}

/**
 * Stamp hop plane + user-facing lane without implying substitution.
 * `target` is the canonical plane. `host_kind` is expected physical shape.
 * @param {unknown} targetOrLane
 */
export function executionLaneStamp(targetOrLane) {
  const raw = trimLower(targetOrLane);
  const target = resolveExecTarget(raw) || raw;
  const lane = laneFromExecTarget(target);
  return {
    target,
    requested_lane: lane,
    resolved_lane: lane,
    lane_substituted: false,
    host_kind: hostKindForExecTarget(target),
  };
}
