export const mcpExecutor = {
  async ensureReady(session) {
    const token = String(session.env?.MCP_AUTH_TOKEN || '').trim();
    if (!token) throw new Error('MCP_AUTH_TOKEN is not configured');
  },
  async execute(session, command, body = {}) {
    return { result: await session.executeMcpCommand(command, body) };
  },
};
