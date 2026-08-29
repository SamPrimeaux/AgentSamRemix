export const ptyExecutor = {
  async ensureReady(session, opts = {}) { await session.ensurePtyConnected(opts); },
  async execute(session, command) {
    if (!command) return { response: Response.json({ error: 'command required' }, { status: 400 }) };
    return { result: await session.executePtyCommand(command) };
  },
};
