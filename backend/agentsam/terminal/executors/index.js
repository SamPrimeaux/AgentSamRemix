import { ptyExecutor } from './pty.js';
import { sshExecutor } from './ssh.js';
import { mcpExecutor } from './mcp.js';
import { batchExecutor } from './batch.js';

const EXECUTORS = { pty: ptyExecutor, ssh: sshExecutor, mcp: mcpExecutor, batch_exec: batchExecutor };
export function resolveTerminalExecutor(mode) {
  return EXECUTORS[mode] || ptyExecutor;
}
