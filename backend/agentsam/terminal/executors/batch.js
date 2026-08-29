import { executeBatchCommand } from '../batch-exec.js';

export const batchExecutor = {
  async ensureReady() {},
  async execute(session, command, body = {}) {
    if (!String(command || '').trim()) {
      return { response: Response.json({ error: 'command required' }, { status: 400 }) };
    }
    return { result: await executeBatchCommand(session, command, body) };
  },
};
