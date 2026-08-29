export const TERMINAL_JOB_STATUSES = Object.freeze([
  'queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out',
]);

export const TERMINAL_JOB_TERMINAL_STATUSES = Object.freeze([
  'succeeded', 'failed', 'cancelled', 'timed_out',
]);

const STATUS_SET = new Set(TERMINAL_JOB_STATUSES);
const TERMINAL_SET = new Set(TERMINAL_JOB_TERMINAL_STATUSES);

export function isValidTerminalJobStatus(status) {
  return STATUS_SET.has(String(status || ''));
}

export function isTerminalJobTerminal(status) {
  return TERMINAL_SET.has(String(status || ''));
}
