import { parseSshTargets } from '../alternate-exec.js';
export const sshExecutor = {
  async ensureReady(session) {
    if (parseSshTargets(session.env).length === 0) throw new Error('SSH targets are not configured');
  },
  async execute(session, command, body = {}) {
    if (!command) return { response: Response.json({ error: 'command required' }, { status: 400 }) };
    return { result: await session.executeSshCommand(command, body) };
  },
};
