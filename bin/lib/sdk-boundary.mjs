import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './repo-root.mjs';

export const SDK_REPOSITORY = 'SamPrimeaux/agentsam-sdk';
export const SDK_PACKAGE = '@inneranimalmedia/agentsam-sdk';
export const SDK_TRACKING_ISSUE = 'https://github.com/SamPrimeaux/agentsam-sdk/issues/10';

/**
 * Every bin/lib module must be classified so portable logic cannot quietly grow
 * into a second SDK inside AgentSamRemix.
 */
export const SDK_BOUNDARY = Object.freeze({
  'repo-root.mjs': {
    ownership: 'host-only',
    reason: 'AgentSamRemix filesystem anchor; intentionally tied to this repository layout.',
  },
  'sdk-boundary.mjs': {
    ownership: 'host-only',
    reason: 'AgentSamRemix CI/operator guard that tracks SDK promotion work.',
  },
  'git-context.mjs': {
    ownership: 'sdk-shim',
    reason: 'Compatibility re-export of the published SDK git-context implementation.',
  },
  'bridge-client.mjs': {
    ownership: 'sdk-shim',
    reason: 'Compatibility re-export of the published SDK bridge-client implementation.',
  },
});

function readPackageJson(pathname) {
  return JSON.parse(readFileSync(pathname, 'utf8'));
}

export function inspectSdkBoundary() {
  const libDir = join(ROOT, 'bin', 'lib');
  const files = readdirSync(libDir)
    .filter((name) => name.endsWith('.mjs'))
    .sort();
  const classified = Object.keys(SDK_BOUNDARY).sort();
  const issues = [];

  for (const file of files) {
    if (!SDK_BOUNDARY[file]) issues.push(`unclassified bin/lib module: ${file}`);
  }
  for (const file of classified) {
    if (!existsSync(join(libDir, file))) issues.push(`SDK boundary references missing module: ${file}`);
  }

  const candidates = [];
  for (const [file, rule] of Object.entries(SDK_BOUNDARY)) {
    if (rule.ownership !== 'sdk-candidate') continue;
    if (!rule.targetPath) issues.push(`SDK candidate missing targetPath: ${file}`);
    if (!rule.trackingIssue?.startsWith(`https://github.com/${SDK_REPOSITORY}/issues/`)) {
      issues.push(`SDK candidate missing canonical SDK tracking issue: ${file}`);
    }
    candidates.push({ file, ...rule });
  }

  const packageJson = readPackageJson(join(ROOT, 'package.json'));
  const declaredSdkVersion = packageJson.dependencies?.[SDK_PACKAGE] || null;
  if (!declaredSdkVersion) issues.push(`${SDK_PACKAGE} must remain an explicit AgentSamRemix dependency`);

  let installedSdkVersion = null;
  const installedPackage = join(ROOT, 'node_modules', ...SDK_PACKAGE.split('/'), 'package.json');
  if (existsSync(installedPackage)) {
    installedSdkVersion = readPackageJson(installedPackage).version || null;
  }

  return {
    ok: issues.length === 0,
    sdkRepository: SDK_REPOSITORY,
    sdkPackage: SDK_PACKAGE,
    trackingIssue: SDK_TRACKING_ISSUE,
    declaredSdkVersion,
    installedSdkVersion,
    files,
    candidates,
    issues,
  };
}

export function assertSdkBoundary() {
  const report = inspectSdkBoundary();
  if (!report.ok) {
    throw new Error(`agentsam_sdk_boundary_failed:\n- ${report.issues.join('\n- ')}`);
  }
  return report;
}

export function formatSdkBoundaryReport(report = inspectSdkBoundary()) {
  const lines = [
    `AgentSam SDK: ${report.sdkRepository}`,
    `npm: ${report.sdkPackage}@${report.declaredSdkVersion || 'missing'}`,
    `handoff: ${report.trackingIssue}`,
    `bin/lib classified: ${report.files.length}`,
  ];
  if (report.installedSdkVersion) lines.push(`installed: ${report.installedSdkVersion}`);
  for (const candidate of report.candidates) {
    lines.push(`promote: bin/lib/${candidate.file} -> agentsam-sdk/${candidate.targetPath}`);
  }
  if (report.issues.length) lines.push(...report.issues.map((issue) => `ERROR: ${issue}`));
  return `${lines.join('\n')}\n`;
}
