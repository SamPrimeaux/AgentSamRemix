/**
 * Resolve how the editor Preview (eye) should render a file — never MYBROWSER.
 */
import type { IdeWorkspaceSnapshot } from '../src/ideWorkspace';

export type PreviewMode = 'srcdoc' | 'devserver' | 'browser';

export type ResolvePreviewInput = {
  fileName: string;
  workspace: IdeWorkspaceSnapshot;
  bytes?: number;
};

const PREVIEW_SERVE_BYTES = 1_500_000;

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** True when the workspace is a local disk folder (PTY dev server viable). */
export function isLocalWorkspace(workspace: IdeWorkspaceSnapshot): boolean {
  return workspace.source === 'local';
}

/**
 * Editor eye-icon preview — `browser` is reserved for explicit agent browser tools / user URL bar.
 */
export function resolvePreviewMode(input: ResolvePreviewInput): PreviewMode {
  const ext = extOf(input.fileName);
  const local = isLocalWorkspace(input.workspace);
  const bytes = input.bytes ?? 0;

  if (local && (ext === 'jsx' || ext === 'tsx' || ext === 'vue')) return 'devserver';
  if (local && ext === 'js' && bytes > 0) return 'devserver';

  if (ext === 'html' || ext === 'htm' || ext === 'md' || ext === 'svg') {
    if (local && bytes >= PREVIEW_SERVE_BYTES) return 'devserver';
    return 'srcdoc';
  }

  if (bytes >= PREVIEW_SERVE_BYTES && local) return 'devserver';

  return 'srcdoc';
}

/** Vite / Next / CRA dev-server stdout patterns */
const DEV_SERVER_URL_RE =
  /(?:Local:\s*|ready\s+in\s+[\d.]+\s*s[^\n]*\n[^\n]*)?(https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)(?:\/[^\s"'<>]*)?)/i;

const DEV_SERVER_PORT_RE =
  /(?:Local:|Network:)\s*https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i;

export function parseDevServerFromTerminalLine(line: string): { port: number; url: string } | null {
  const raw = String(line || '');
  const m = raw.match(DEV_SERVER_URL_RE) || raw.match(DEV_SERVER_PORT_RE);
  if (!m) return null;
  const port = Number(m[2] ?? m[1]);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  const url = m[1]?.startsWith('http') ? m[1].replace(/\/$/, '') : `http://localhost:${port}`;
  return { port, url };
}

export async function probeDevServerUrl(url: string, timeoutMs = 1800): Promise<boolean> {
  const u = url.trim();
  if (!u) return false;
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(u, { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(t);
  }
}
