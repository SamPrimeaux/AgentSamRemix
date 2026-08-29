import {
  buildIamPtyEnvBlock,
  createHostedTunnelConnection,
  fetchCfZones,
  fetchHostedTunnelConnections,
  fetchPtyDefaults,
  fetchPtyStatus,
  generatePtyToken,
  hasCloudflareTerminalAccess,
  provisionPtyTunnel,
  setDefaultHostedTunnelConnection,
  type CfZone,
} from './ptyTerminalSetupApi';

export type PtyWizardIO = {
  writeln: (text: string) => void;
  write: (text: string) => void;
  prompt: (label: string, opts?: { mask?: boolean; defaultValue?: string }) => Promise<string | null>;
  choose: (title: string, options: { key: string; label: string }[]) => Promise<string | null>;
};

export type PtyWizardContext = {
  workspaceId: string;
  sessionUserId: string | null;
  workerOrigin: string;
  openKeysSettings?: () => void;
  onConnectLocal?: () => void | Promise<void>;
  /** Pin + provision a specific hosted tunnel row (multi-machine). */
  hostedConnectionId?: string | null;
  onHostedConnectionPinned?: (connectionId: string) => void;
};

const CYAN = '\x1b[38;5;45m';
const DIM = '\x1b[38;5;240m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const OK = '\x1b[38;5;82m';
const WARN = '\x1b[38;5;208m';
const ERR = '\x1b[1;31m';

function banner(io: PtyWizardIO) {
  io.writeln('');
  io.writeln(`${CYAN}${BOLD}  IAM Terminal Setup${RESET}`);
  io.writeln(`${DIM}  Cloudflare tunnel + ExecOS/localpty — step-by-step${RESET}`);
  io.writeln(`${DIM}  Ctrl+C skips a prompt · empty line uses default when shown${RESET}`);
  io.writeln('');
}

async function pickZone(io: PtyWizardIO, zones: CfZone[]): Promise<CfZone | null> {
  if (zones.length === 0) return null;
  if (zones.length === 1) return zones[0];
  const key = await io.choose(
    'Select your Cloudflare zone',
    zones.map((z, i) => ({
      key: String(i + 1),
      label: `${z.name} (${z.id.slice(0, 8)}…)`,
    })),
  );
  if (!key) return null;
  const idx = Number.parseInt(key, 10) - 1;
  return zones[idx] ?? null;
}

export async function runPtyTerminalSetupWizard(io: PtyWizardIO, ctx: PtyWizardContext): Promise<void> {
  const ws = ctx.workspaceId.trim();
  if (!ws) {
    io.writeln(`${ERR}  No workspace selected. Open a workspace first.${RESET}`);
    return;
  }

  banner(io);

  let hostedConnectionId = ctx.hostedConnectionId?.trim() || '';
  const existingHosted = await fetchHostedTunnelConnections(ws);
  if (existingHosted.length > 0) {
    const pickOpts = [
      { key: 'new', label: 'Create new remote machine' },
      ...existingHosted.map((c) => ({
        key: c.id,
        label: `${c.is_default ? '★ ' : ''}${c.name}${c.hostname ? ` · ${c.hostname}` : ''}${c.is_active ? ' · live' : ''}`,
      })),
    ];
    const pick = await io.choose('Remote machine', pickOpts);
    if (!pick) {
      io.writeln(`${DIM}  Setup cancelled.${RESET}`);
      return;
    }
    if (pick === 'new') {
      const name =
        (await io.prompt('Machine name', { defaultValue: 'Remote machine' }))?.trim() ||
        'Remote machine';
      const created = await createHostedTunnelConnection(ws, { name });
      if (!created?.id) {
        io.writeln(`${ERR}  Could not create connection row.${RESET}`);
        return;
      }
      hostedConnectionId = created.id;
    } else {
      hostedConnectionId = pick;
    }
    await setDefaultHostedTunnelConnection(ws, hostedConnectionId);
    ctx.onHostedConnectionPinned?.(hostedConnectionId);
  } else if (!hostedConnectionId) {
    const name =
      (await io.prompt('Machine name', { defaultValue: 'Remote machine' }))?.trim() ||
      'Remote machine';
    const created = await createHostedTunnelConnection(ws, { name });
    if (!created?.id) {
      io.writeln(`${ERR}  Could not create connection row.${RESET}`);
      return;
    }
    hostedConnectionId = created.id;
    await setDefaultHostedTunnelConnection(ws, hostedConnectionId);
    ctx.onHostedConnectionPinned?.(hostedConnectionId);
  }

  let status = await fetchPtyStatus(ws);
  let hasCf = await hasCloudflareTerminalAccess(ws);
  const defaults = await fetchPtyDefaults(ws);

  io.writeln(`${BOLD}  Status${RESET}`);
  io.writeln(
    `  Cloudflare API key   ${hasCf ? `${OK}✓${RESET}` : `${WARN}✗ add in Keys & Secrets${RESET}`}`,
  );
  io.writeln(
    `  PTY bridge token     ${status.token?.has_token ? `${OK}✓${RESET} (••••${status.token?.last4 || '????'})` : `${WARN}○ not yet${RESET}`}`,
  );
  io.writeln(
    `  Cloudflare tunnel    ${status.tunnel?.tunnel_id || status.tunnel?.hostname ? `${OK}✓${RESET}` : `${WARN}○ not yet${RESET}`}`,
  );
  const live =
    status.local?.connection?.is_active ||
    status.tunnel?.connection_active ||
    status.token?.connection_active;
  io.writeln(`  Tunnel connected     ${live ? `${OK}✓${RESET}` : `${WARN}○ waiting for cloudflared${RESET}`}`);
  io.writeln('');

  if (!hasCf) {
    io.writeln(`${WARN}  Step 0:${RESET} Add a Cloudflare provider API token in Keys & Secrets`);
    io.writeln(`${DIM}  Needs Account → Cloudflare Tunnel (Edit) + Zone → DNS (Edit) scopes.${RESET}`);
    if (ctx.openKeysSettings) {
      const go = await io.prompt('Open Keys settings now? [y/N]', { defaultValue: 'n' });
      if (go?.toLowerCase() === 'y') ctx.openKeysSettings();
    }
    const retry = await io.prompt('Press Enter when your Cloudflare key is saved (or Ctrl+C to exit)', {
      defaultValue: '',
    });
    if (retry === null) return;
    hasCf = await hasCloudflareTerminalAccess(ws);
    if (!hasCf) {
      io.writeln(`${ERR}  Still no Cloudflare key detected. Aborting setup.${RESET}`);
      return;
    }
    io.writeln(`${OK}  Cloudflare key found.${RESET}`);
  }

  const platformChoice = await io.choose('Choose your machine', [
    { key: '1', label: 'Windows — PowerShell + cloudflared' },
    { key: '2', label: 'macOS — zsh + cloudflared' },
    { key: '3', label: 'Linux — bash + cloudflared' },
  ]);
  if (!platformChoice) {
    io.writeln(`${DIM}  Setup cancelled.${RESET}`);
    return;
  }
  const platform =
    platformChoice === '2' ? 'macos' : platformChoice === '3' ? 'linux' : 'windows';
  const shell =
    platformChoice === '2' ? 'zsh' : platformChoice === '3' ? 'bash' : 'powershell';

  let ptyTokenOnce = '';
  if (!status.token?.has_token) {
    io.writeln('');
    io.writeln(`${BOLD}  Step 1:${RESET} Generate PTY bridge token`);
    const go = await io.prompt('Generate token now? [Y/n]', { defaultValue: 'y' });
    if (go === null) return;
    if (go.toLowerCase() !== 'n') {
      try {
        ptyTokenOnce = await generatePtyToken(ws);
        io.writeln(`${OK}  Token created — copy it now (shown once):${RESET}`);
        io.writeln(`  ${ptyTokenOnce}`);
      } catch (e) {
        io.writeln(`${ERR}  ${e instanceof Error ? e.message : String(e)}${RESET}`);
        return;
      }
    }
  } else {
    io.writeln(`${DIM}  PTY token already active — skip generation or rotate from Keys later.${RESET}`);
  }

  status = await fetchPtyStatus(ws);

  io.writeln('');
  io.writeln(`${BOLD}  Step 2:${RESET} Cloudflare tunnel on your zone`);
  let zones: CfZone[] = [];
  try {
    zones = await fetchCfZones(ws);
  } catch (e) {
    io.writeln(`${WARN}  Could not list zones: ${e instanceof Error ? e.message : String(e)}${RESET}`);
  }

  const defaultTunnel =
    defaults?.tunnel_name?.trim() ||
    status.tunnel?.tunnel_name?.trim() ||
    'my-pty';
  const tunnelName =
    (await io.prompt(`Tunnel name [${defaultTunnel}]`, { defaultValue: defaultTunnel }))?.trim() ||
    defaultTunnel;

  let zone: CfZone | null = null;
  if (zones.length > 0) {
    zone = await pickZone(io, zones);
  }
  let zoneId = zone?.id || defaults?.zone_id?.trim() || status.tunnel?.zone_id?.trim() || '';
  if (!zoneId) {
    zoneId =
      (await io.prompt('Cloudflare zone ID', { defaultValue: '' }))?.trim() || '';
  }
  if (!zoneId) {
    io.writeln(`${ERR}  Zone ID required.${RESET}`);
    return;
  }

  const zoneName = zone?.name || zones.find((z) => z.id === zoneId)?.name || '';
  const defaultHost =
    defaults?.hostname?.trim() ||
    status.tunnel?.hostname?.trim() ||
    (zoneName ? `pty.${zoneName}` : 'pty.yourdomain.com');
  const hostname =
    (await io.prompt(`Public hostname [${defaultHost}]`, { defaultValue: defaultHost }))?.trim() ||
    defaultHost;

  const provisionNow = await io.prompt('Create / update tunnel now? [Y/n]', { defaultValue: 'y' });
  if (provisionNow === null) return;

  let runToken = status.tunnel?.run_token || '';
  let finalHost = hostname;
  if (provisionNow.toLowerCase() !== 'n') {
    try {
      io.writeln(`${DIM}  Provisioning tunnel via Cloudflare API…${RESET}`);
      const prov = await provisionPtyTunnel(ws, {
        tunnel_name: tunnelName,
        hostname,
        zone_id: zoneId,
        platform,
        shell,
        connection_id: hostedConnectionId || undefined,
        connection_name: tunnelName,
      });
      if (prov.connection_id) {
        hostedConnectionId = prov.connection_id;
        ctx.onHostedConnectionPinned?.(hostedConnectionId);
      }
      if (prov.run_token) runToken = prov.run_token;
      if (prov.hostname) finalHost = prov.hostname;
      io.writeln(`${OK}  Tunnel provisioned.${RESET}`);
    } catch (e) {
      io.writeln(`${ERR}  ${e instanceof Error ? e.message : String(e)}${RESET}`);
      return;
    }
  }

  status = await fetchPtyStatus(ws);
  if (!runToken && status.tunnel?.run_token) runToken = status.tunnel.run_token;

  const uid = ctx.sessionUserId || 'YOUR_USER_ID';
  const tokenForEnv = ptyTokenOnce || 'YOUR_PTY_AUTH_TOKEN';
  const runForEnv = runToken || 'YOUR_CLOUDFLARED_RUN_TOKEN';

  io.writeln('');
  io.writeln(`${BOLD}  Step 3:${RESET} Run on your machine`);
  if (runToken) {
    io.writeln(`${DIM}  Terminal A:${RESET}`);
    io.writeln(`  cloudflared tunnel run --token ${runToken}`);
  }
  io.writeln('');
  const envBlock = buildIamPtyEnvBlock({
    sessionUserId: uid,
    workspaceId: ws,
    ptyToken: tokenForEnv,
    hostname: finalHost,
    runToken: runForEnv,
    workerOrigin: ctx.workerOrigin,
  });
  io.writeln(envBlock);
  io.writeln('');

  if (ctx.onConnectLocal) {
    const connect = await io.prompt('Connect local terminal here now? [Y/n]', { defaultValue: 'y' });
    if (connect !== null && connect.toLowerCase() !== 'n') {
      io.writeln(`${DIM}  Connecting user-hosted tunnel lane…${RESET}`);
      await ctx.onConnectLocal();
    }
  }

  io.writeln(`${OK}  Setup complete. Re-run from + → Configure Terminal Settings anytime.${RESET}`);
}
