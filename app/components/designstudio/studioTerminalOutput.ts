export type StudioOutputLevel = 'info' | 'warn' | 'error' | 'ok';

export type StudioTerminalTab = 'terminal' | 'output' | 'problems';

function formatLine(text: string, level: StudioOutputLevel): string {
  const ts = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const tag =
    level === 'error' ? 'ERR' : level === 'warn' ? 'WRN' : level === 'ok' ? ' OK' : 'INF';
  return `[${ts}] [design-studio] [${tag}] ${text}`;
}

/** Append a line to the App shell terminal OUTPUT tab. */
export function appendStudioTerminalOutput(
  text: string,
  level: StudioOutputLevel = 'info',
  opts?: { open?: boolean; tab?: StudioTerminalTab },
) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('iam-terminal-output', {
      detail: {
        line: formatLine(text, level),
        open: opts?.open ?? false,
        tab: opts?.tab ?? 'output',
      },
    }),
  );
}

/** Open the global terminal drawer on a specific tab (default: output). */
export function openStudioTerminal(opts?: { tab?: StudioTerminalTab }) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('iam-terminal-toggle', {
      detail: { open: true, tab: opts?.tab ?? 'output' },
    }),
  );
}
