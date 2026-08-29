import type { AgentWorkspaceContextPacket } from '../../src/ideWorkspace';
import type { TerminalTarget } from '../LocalTerminalSetup';
import type { TerminalSplashStatus } from '../../src/lib/terminalSplashStatus';
import type { TerminalConnectionStatus } from '../TerminalSessionPane';

export const DEFAULT_PRODUCT = 'Agent Sam';
export type ShellTab = 'terminal' | 'output' | 'problems';
/** Lane pick from chrome / events (ex-splash actions). */
export type TerminalLaneAction = 'local' | 'cloud' | 'sandbox' | 'sdk';

export const LS_SHELL = 'iam_terminal_shell_pref';
export const LS_SPLIT = 'iam_terminal_split';
export const LS_PAGE_HEIGHT = 'iam_agent_terminal_h';

export function statusMessage(s: TerminalConnectionStatus): string {
  switch (s) {
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'reconnecting':
      return 'Reconnecting';
    case 'offline':
      return 'Offline';
    case 'auth_failed':
      return 'Auth failed';
    case 'backend_unavailable':
      return 'Backend unavailable';
    case 'session_expired':
      return 'Session expired';
    case 'timed_out':
      return 'Timed out';
    case 'disconnected':
      return 'Disconnected';
    default:
      return 'Disconnected';
  }
}

export interface XTermShellHandle {
  writeToTerminal: (text: string) => void;
  runCommand: (cmd: string) => void;
  setActiveTab: (t: ShellTab) => void;
  /** Close PTY session without reconnect (workspace switch). */
  disconnect: () => void;
}

export interface XTermShellProps {
  onClose: () => void;
  problems?: { file: string; line: number; msg: string; severity: 'error' | 'warning'; ts?: string; id?: string }[];
  outputLines?: string[];
  onOutputLine?: (line: string) => void;
  /** Refetch /api/agent/problems when the Problems tab is opened. */
  onProblemsTabOpen?: () => void;
  iamOrigin?: string;
  workspaceCdCommand?: string;
  agentDashboardUrl?: string;
  showIamWelcomeBar?: boolean;
  workspaceLabel?: string;
  workspaceId?: string;
  /** Initial / workspace-default lane recommendation (not a live override after user picks). */
  targetType?: TerminalTarget;
  /** Persist lane when user switches via VM / + menu. */
  onTargetTypeChange?: (target: TerminalTarget) => void;
  splashStatus?: TerminalSplashStatus | null;
  splashStatusLoading?: boolean;
  onConnected?: (cwd: string | null, targetType?: TerminalTarget) => void;
  productLabel?: string;
  layout?: 'page' | 'drawer';
  workspaceContext?: AgentWorkspaceContextPacket | null;
  /** Passed from App — lazy XTermShell chunk must not import WorkspaceContext (duplicate React context). */
  sessionUserId?: string | null;
  /** Mobile: skip the splash chooser entirely and connect straight to the recommended target. */
  autoConnect?: boolean;
}

export const SHELL_CHOICES = [
  { label: 'bash', path: '/bin/bash' },
  { label: 'zsh', path: '/bin/zsh' },
] as const;
