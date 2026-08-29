import { executeHttpTerminalTransport } from './http-exec.js';

export const localTerminalTransport = {
  name: 'user_hosted_tunnel',
  async execute(session, plan, ctx) {
    if (!plan.connection?.ws_url) throw new Error('user_hosted_tunnel_unreachable');
    return executeHttpTerminalTransport(session, plan, ctx);
  },
};
