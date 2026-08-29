/**
 * Workspace-scoped delivery workflow for in-app Agent Sam.
 * Injects ship discipline (implement → validate → commit/push → deploy → next steps)
 * only when the workspace row declares a ship lane via metadata — never by memorizing
 * specific repo / slug / worker names in code.
 *
 * Classification SSOT: metadata_json.workspace_kind (+ optional delivery/ship flags).
 * github_repo / root_path / worker_name / deploy_patterns come from the row only.
 * Missing required fields → fail closed (null profile), never invent core infra defaults.
 */
import { getAgentsamWorkspace, parseWorkspaceMetadata } from '../../backend/identity/workspace/agentsam-workspace.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {string} lowercase workspace_kind or ''
 */
export function workspaceKindFromRow(row) {
  if (!row) return '';
  return trim(parseWorkspaceMetadata(row.metadata_json).workspace_kind).toLowerCase();
}

/**
 * Display slug for prompt context only — never used to classify ship lane.
 * @param {Record<string, unknown>|null|undefined} row
 */
export function workspaceSlugFromRow(row) {
  if (!row) return '';
  return trim(row.workspace_slug || row.worker_name || row.id?.replace(/^ws_/, '')).toLowerCase();
}

/**
 * MCP worker ship lane — metadata_json.workspace_kind === 'mcp_server' only.
 * @param {Record<string, unknown>|null|undefined} row
 */
export function isMcpServerWorkspace(row) {
  return workspaceKindFromRow(row) === 'mcp_server';
}

/**
 * Primary platform-app ship lane (Mac deploy:full/fast · VM ship:remote).
 * Kind values only — never slug/worker/github_repo string matches.
 * Live D1 uses `platform`; `main_saas` / `platform_app` accepted as aliases.
 * @param {Record<string, unknown>|null|undefined} row
 */
export function isMainIamPlatformWorkspace(row) {
  const kind = workspaceKindFromRow(row);
  return kind === 'platform' || kind === 'main_saas' || kind === 'platform_app';
}

/**
 * Generic ship-lane kinds (not MCP / not platform-app). Kind taxonomy only —
 * set delivery_workflow / ship_workflow on the row for any other kind.
 */
const COLLAB_SHIP_KINDS = new Set(['client_saas', 'collab', 'client_worker']);

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
export function workspaceHasShipProfile(row) {
  if (!row) return false;
  if (isMcpServerWorkspace(row) || isMainIamPlatformWorkspace(row)) return true;
  const meta = parseWorkspaceMetadata(row.metadata_json);
  const kind = workspaceKindFromRow(row);
  if (kind && COLLAB_SHIP_KINDS.has(kind)) return true;
  if (meta.delivery_workflow === true || meta.ship_workflow === true) return true;
  return false;
}

function deployPatternsFromRow(row) {
  const meta = parseWorkspaceMetadata(row?.metadata_json);
  const patterns = meta.deploy_patterns;
  return patterns && typeof patterns === 'object' ? patterns : {};
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
export function resolveWorkspaceShipProfile(row) {
  if (!workspaceHasShipProfile(row)) return null;

  const kind = workspaceKindFromRow(row);
  const slug = workspaceSlugFromRow(row);
  const githubRepo = trim(row.github_repo) || null;
  const meta = parseWorkspaceMetadata(row.metadata_json);
  const patterns = deployPatternsFromRow(row);
  const deployFromMeta = trim(meta.deploy_command || meta.deployCommand);
  const rootPath =
    trim(row.root_path) ||
    trim(meta.repo?.local_path) ||
    null;

  if (isMcpServerWorkspace(row)) {
    const workerName = trim(row.worker_name);
    if (!workerName) {
      console.error('[agent-delivery-policy] worker_name_required for mcp_server ship profile', {
        kind,
        slug,
      });
      return null;
    }
    if (!rootPath) {
      console.error('[agent-delivery-policy] root_path_required for mcp_server ship profile', {
        kind,
        slug,
      });
      return null;
    }
    if (!githubRepo) {
      console.error('[agent-delivery-policy] github_repo_required for mcp_server ship profile', {
        kind,
        slug,
      });
      return null;
    }
    const deployCommand =
      deployFromMeta ||
      trim(patterns.full) ||
      'npm run deploy:full';
    return {
      kind: 'mcp_server',
      slug,
      githubRepo,
      workerName,
      rootPath,
      deployCommand,
      validateHint:
        trim(patterns.validate_worker) ||
        'node --check src/index.js — MCP worker repo only (no app/dashboard/vite build)',
      deployUrl: trim(row.deploy_url) || null,
      repoNote:
        'This is an MCP server workspace (workspace_kind=mcp_server) — edit, commit, and deploy only from that workspace repo root. Never run main-app Vite builds here.',
      migrationsNote:
        'Apply D1 migrations from this workspace repo when that SQL changed — never from the wrong checkout.',
    };
  }

  if (isMainIamPlatformWorkspace(row)) {
    const workerName = trim(row.worker_name);
    if (!workerName) {
      console.error('[agent-delivery-policy] worker_name_required for platform ship profile', {
        kind,
        slug,
      });
      return null;
    }
    if (!rootPath) {
      console.error('[agent-delivery-policy] root_path_required for platform ship profile', {
        kind,
        slug,
      });
      return null;
    }
    if (!githubRepo) {
      console.error('[agent-delivery-policy] github_repo_required for platform ship profile', {
        kind,
        slug,
      });
      return null;
    }
    const deployCommand =
      deployFromMeta ||
      trim(patterns.full) ||
      'Mac: npm run deploy:full (or deploy:fast). GCP iam-tunnel / remote PTY: npm run ship:remote ONLY — never Vite or deploy:full on the VM (OOM). See docs/platform/mac-free-ship-lanes-2026-07.md';
    return {
      kind: 'main_saas',
      slug,
      githubRepo,
      workerName,
      rootPath,
      deployCommand,
      validateHint:
        [
          trim(patterns.build_vite) ? `${trim(patterns.build_vite)} when dashboard touched` : null,
          trim(patterns.validate_worker) || 'node --check on edited worker .js',
        ]
          .filter(Boolean)
          .join('; '),
      deployUrl: trim(row.deploy_url) || null,
      repoNote:
        'This is a platform-app workspace (workspace_kind declares the Mac/VM ship lane). MCP OAuth/tools work belongs in a workspace_kind=mcp_server row — separate repo and deploy.',
      migrationsNote:
        'Apply this workspace’s D1 migrations via wrangler against the configured business DB when SQL changed.',
    };
  }

  // Collab / client / companion kinds: still require github_repo when we will instruct commit/push.
  if (!githubRepo) {
    console.error('[agent-delivery-policy] github_repo_required for ship profile', { kind, slug });
    return null;
  }
  if (!rootPath) {
    console.error('[agent-delivery-policy] root_path_required for ship profile', { kind, slug });
    return null;
  }

  const deployCommand =
    deployFromMeta ||
    trim(patterns.full) ||
    (trim(row.deploy_url)
      ? `Deploy worker ${trim(row.worker_name) || slug} (${trim(row.deploy_url)})`
      : null);

  return {
    kind: kind || 'collab',
    slug,
    githubRepo,
    workerName: trim(row.worker_name) || null,
    rootPath,
    deployCommand,
    validateHint:
      trim(patterns.validate_worker) ||
      'Build/lint/check touched files for this workspace repo before commit.',
    deployUrl: trim(row.deploy_url) || null,
    repoNote: `Work in repo root: ${rootPath}`,
    migrationsNote: null,
  };
}

const DELIVERY_HEADING = '## Delivery workflow (LOCKED — active workspace)';

/**
 * @param {ReturnType<typeof resolveWorkspaceShipProfile>} profile
 * @param {{ mode?: string }} [opts]
 */
export function buildDeliveryPolicyPromptBlock(profile, opts = {}) {
  if (!profile) return '';
  if (trim(opts.mode).toLowerCase() === 'ask') return '';

  const cwdLine = profile.rootPath
    ? `All file edits, git, and terminal work: **\`${profile.rootPath}\`** (this workspace repo only).`
    : 'Work only in this workspace repo — do not assume another workspace root.';

  const lines = [
    DELIVERY_HEADING,
    '',
    profile.repoNote || '',
    cwdLine,
    '',
    'Unless the user explicitly says **local only**, **no commit**, **no push**, **no deploy**, **plan only**, or **review only**, complete this order for every implementation task:',
    '',
    '1. **Finish the work** — end-to-end; no partial handoffs.',
    `2. **Validate locally** — ${profile.validateHint || 'build/lint/check touched files.'}`,
    `3. **Commit + push** — in \`${profile.githubRepo}\`; why-focused message; never secrets.`,
  ];

  if (profile.deployCommand) {
    lines.push(
      `4. **Deploy** — from repo root \`${profile.rootPath || 'see workspace root'}\`: ${profile.deployCommand}`,
    );
    if (profile.kind === 'main_saas') {
      lines.push(
        '   **If you are on GCP iam-tunnel / remote PTY:** run `npm run ship:remote` only. Never `deploy:full`, Vite, or rclone on the VM.',
      );
    }
    if (profile.migrationsNote) lines.push(`   ${profile.migrationsNote}`);
  } else {
    lines.push('4. **Deploy** — only when this workspace has a documented deploy path.');
  }

  lines.push(
    '5. **Follow up** — shipped, verified checks, git commit hash, and 1–3 logical next steps.',
    '',
    'Do **not** ask permission to commit or deploy when no opt-out was given — execute the workflow.',
    'Never force-push main. Never skip hooks unless the user asked.',
  );

  const ctx = [
    profile.kind ? `lane: ${profile.kind}` : null,
    profile.slug ? `slug: ${profile.slug}` : null,
    profile.workerName ? `worker: ${profile.workerName}` : null,
    profile.deployUrl ? `live: ${profile.deployUrl}` : null,
  ].filter(Boolean);
  if (ctx.length) lines.push('', `Context: ${ctx.join(' · ')}`);

  return lines.filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');
}

/**
 * @param {any} env
 * @param {string} systemPrompt
 * @param {{ workspaceId?: string|null, mode?: string }} opts
 */
export async function appendDeliveryPolicyToPrompt(env, systemPrompt, opts = {}) {
  const ws = trim(opts.workspaceId);
  if (!ws || trim(opts.mode).toLowerCase() === 'ask') return systemPrompt;

  const row = await getAgentsamWorkspace(env, ws);
  const profile = resolveWorkspaceShipProfile(row);
  if (!profile) return systemPrompt;

  const block = buildDeliveryPolicyPromptBlock(profile, opts);
  if (!block || systemPrompt.includes(DELIVERY_HEADING)) return systemPrompt;

  return `${systemPrompt}\n\n${block}\n`;
}
