/** Types & constants for TerminalSessionPane / PTY websocket. */

export type TerminalConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'auth_failed'
  | 'backend_unavailable'
  | 'session_expired'
  | 'disconnected'
  | 'timed_out';


export const INACTIVITY_MS = 5 * 60 * 1000;


/**
 * Remote-only prompt repair after PTY connect (platform_vm / ExecOS).
 * Never send on user_hosted_tunnel — Mac zsh already has a real prompt.
 * Ends with clear-line escapes so any echoed inject is wiped — do not pair with
 * client-typed `stty -echo` (that command always echoes once itself).
 * Interactive sessions are per-browser (`pty_client`); do not share this inject
 * across phone and desk.
 */
export const PTY_PROMPT_REPAIR_CMD =
  'if [ -n "${ZSH_VERSION:-}" ]; then unset PS1; PROMPT="[%n@%m %1~]%# "; elif [ -n "${BASH_VERSION:-}" ]; then PS1="[\\u@\\h \\W]\\$ "; fi; printf "\\r\\033[K\\033[A\\033[2K\\r"';


export const RETRYABLE_STATES: ReadonlySet<TerminalConnectionStatus> = new Set([
  'connecting',
  'reconnecting',
  'backend_unavailable',
  'disconnected',
]);


export interface TerminalSessionPaneHandle {
  writeToTerminal: (text: string) => void;
  writeAnsi: (text: string) => void;
  runCommand: (cmd: string) => void;
  reconnectClean: () => void;
  /** Stop PTY without reconnecting (e.g. return to welcome splash). */
  disconnectQuiet: () => void;
  getSessionId: () => string | null;
  /** Hold prompt + lift: clipboard.readText, or a last-resort sheet. */
  pasteFromClipboard: () => Promise<{ ok: boolean; reason?: string }>;
  /** Local line prompt (setup wizard) — does not send to remote PTY. */
  promptLine: (
    label: string,
    opts?: { mask?: boolean; defaultValue?: string },
  ) => Promise<string | null>;
}


/** Server TerminalBinding receipt — UI trust strip source of truth. */
export type TerminalBindingReceipt = {
  protocol?: string | null;
  lane?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  host_kind?: string | null;
  transport?: string | null;
  workspace_id?: string | null;
  cwd?: string | null;
};

export interface TerminalSessionPaneProps {
  workspaceId?: string;
  /** platform_vm (cloud) or user_hosted_tunnel (local machine). */
  targetType?: 'platform_vm' | 'user_hosted_tunnel' | 'sandbox';
  /** Pin a specific user_hosted_tunnel row when multiple remote machines exist. */
  hostedConnectionId?: string | null;
  /** Secondary pane id → Worker routes to distinct DO (split terminals). */
  ptySlot?: string;
  /** Full path, e.g. /bin/zsh — forwarded to PTY */
  shell?: string;
  visible: boolean;
  /** When false, xterm mounts but WebSocket PTY does not connect (welcome splash). */
  connectEnabled?: boolean;
  onConnectionChange?: (s: TerminalConnectionStatus) => void;
  onSessionIdChange?: (id: string | null) => void;
  /** Immutable binding from server — never invent labels from client targetType alone. */
  onBindingChange?: (binding: TerminalBindingReceipt | null) => void;
  /** PTY stdout lines (ANSI stripped) — dev-server port detection, output tab, etc. */
  onTerminalOutputLine?: (line: string) => void;
  /** Config/backend hard failure — parent may re-show welcome splash. */
  onHardFailure?: () => void;
  /** Tunnel health pushed by the AGENT_SESSION DO alarm over this socket
   * (type: "tunnel_health") — status-bar also polls lane-scoped
   * /api/tunnel/status/{local|remote|sandbox|disconnected}. null until first message. */
  onTunnelHealth?: (health: { healthy: boolean; connections: number } | null) => void;
}
