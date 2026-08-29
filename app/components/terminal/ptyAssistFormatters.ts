/** Model catalog / SDK bootstrap formatters for PTY welcome & slash commands. */

type AgentModelRow = {
  model_key?: string;
  name?: string;
  provider?: string;
  size_class?: string;
  api_platform?: string;
  byok_configured?: boolean;
  byok_masked?: string | null;
  billing_key_source?: string;
};

/** BYOK status grouped by provider family for terminal hints. */
async function fetchModelByokSummary(): Promise<Map<string, { configured: boolean; masked: string | null }>> {
  const map = new Map<string, { configured: boolean; masked: string | null }>();
  const bucketForPlatform = (apiPlatform: string): string | null => {
    const p = String(apiPlatform || '').trim().toLowerCase();
    if (!p) return null;
    if (p.includes('openai') || p === 'cursor') return 'openai';
    if (p.includes('anthropic')) return 'anthropic';
    if (p.includes('cloudflare') || p.includes('workers_ai') || p === 'workersai') return 'cloudflare';
    if (p.includes('google') || p.includes('gemini')) return 'google';
    return null;
  };
  try {
    const res = await fetch('/api/agent/models', { credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) return map;
    for (const m of data as AgentModelRow[]) {
      const bucket = bucketForPlatform(String(m.api_platform || m.provider || ''));
      if (!bucket) continue;
      const prev = map.get(bucket);
      const configured = m.byok_configured === true || m.billing_key_source === 'byok';
      if (!prev || (configured && !prev.configured)) {
        map.set(bucket, {
          configured: configured || prev?.configured === true,
          masked: m.byok_masked ?? prev?.masked ?? null,
        });
      }
    }
  } catch {
    /* ignore */
  }
  return map;
}

/** Active picker models (`GET /api/agent/models` → agentsam_model_catalog). */
export async function formatAgentsamModelsToTerminal(
  write: (text: string) => void,
): Promise<void> {
  write('\r\n\x1b[38;5;51m  ══ Agent Sam — models & BYOK ═════════════════════════\x1b[0m\r\n');
  try {
    const res = await fetch('/api/agent/models', { credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) {
      write('\x1b[38;5;196m  ✗ Could not load model catalog\x1b[0m\r\n');
      return;
    }
    const rows = (data as AgentModelRow[]).filter((m) => m?.model_key);
    if (!rows.length) {
      write('\x1b[38;5;240m  (no active models in agentsam_model_catalog)\x1b[0m\r\n');
      return;
    }
    for (const m of rows) {
      const key = String(m.model_key);
      const label = m.name ? String(m.name) : key;
      const provider = m.provider ? String(m.provider) : '—';
      const tier = m.size_class ? ` · ${String(m.size_class)}` : '';
      const byok =
        m.byok_configured || m.billing_key_source === 'byok'
          ? '\x1b[38;5;82mBYOK\x1b[0m'
          : '\x1b[38;5;240mplatform\x1b[0m';
      write(
        `\x1b[38;5;250m  ${key.padEnd(28)}\x1b[0m \x1b[38;5;240m${provider}${tier}\x1b[0m  ${byok}  \x1b[38;5;82m${label}\x1b[0m\r\n`,
      );
    }
    write('\x1b[38;5;240m  Paste keys: Dashboard → Settings → Keys (OpenAI / Anthropic / Cloudflare)\x1b[0m\r\n');
    write('\x1b[38;5;51m  ══════════════════════════════════════════════════════\x1b[0m\r\n');
  } catch (e: unknown) {
    write(
      `\x1b[38;5;196m  ✗ ${e instanceof Error ? e.message : 'Model catalog fetch failed'}\x1b[0m\r\n`,
    );
  }
}

/** Option 4 — bootstrap @inneranimalmedia/agentsam-sdk (Agent Sam developing itself). */
export async function formatAgentsamSdkBootstrapToTerminal(
  write: (text: string) => void,
  opts?: { cdCommand?: string; cloudReady?: boolean },
): Promise<void> {
  const cd = (opts?.cdCommand || 'cd inneranimalmedia/my-app').trim();
  write('\r\n\x1b[38;5;51m  ══ Agent Sam SDK — first use case ═════════════════════\x1b[0m\r\n');
  write('\x1b[38;5;250m  Package\x1b[0m  @inneranimalmedia/agentsam-sdk\r\n');
  write('\x1b[38;5;250m  Goal\x1b[0m    Smoke-test orchestrator on Workers (self-host loop)\r\n\r\n');

  const byok = await fetchModelByokSummary();
  const providers = [
    { key: 'openai', label: 'OpenAI' },
    { key: 'anthropic', label: 'Anthropic' },
    { key: 'cloudflare', label: 'Cloudflare AI' },
  ];
  write('\x1b[38;5;250m  Provider keys (BYOK)\x1b[0m\r\n');
  for (const p of providers) {
    const slot = byok.get(p.key);
    const status = slot?.configured
      ? `\x1b[38;5;82m✓ connected${slot.masked ? ` (${slot.masked})` : ''}\x1b[0m`
      : '\x1b[38;5;208m○ paste in Settings → Keys\x1b[0m';
    write(`    ${p.label.padEnd(14)} ${status}\r\n`);
  }

  write('\r\n\x1b[38;5;250m  Cloud terminal steps\x1b[0m\r\n');
  if (opts?.cloudReady === false) {
    write('\x1b[38;5;208m  Cloud PTY not ready — pick option 2 first, then re-run option 4.\x1b[0m\r\n');
  }
  const appCd = /my-app\s*$/.test(cd) ? cd : `${cd.replace(/\s+$/, '')}/my-app`;
  write(`    ${appCd}\r\n`);
  write('    npm install\r\n');
  write('    npm run smoke\r\n');
  write('\r\n\x1b[38;5;240m  Slash /agentsam in terminal lists models · /dashboard/settings/keys for BYOK\x1b[0m\r\n');
  write('\x1b[38;5;51m  ══════════════════════════════════════════════════════\x1b[0m\r\n');
}

export function agentsamSdkBootstrapCommands(cdCommand?: string): string[] {
  const raw = (cdCommand || 'cd inneranimalmedia').trim();
  const appCd = /my-app\s*$/.test(raw) ? raw : `${raw.replace(/\s+$/, '')}/my-app`;
  return [appCd, 'npm install', 'npm run smoke'];
}

export function isAgentsamModelsSlashLine(line: string): boolean {
  const t = line.trim();
  return t === '/agentsam' || /^\/agentsam\s*$/i.test(t);
}
