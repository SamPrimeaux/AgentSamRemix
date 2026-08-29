/**
 * Tool: Terminal (term)
 * Allows the agent to run shell commands in the workspace PTY.
 */

import { executeTerminalHandlerRun } from '../../../src/core/terminal-handler-run.js';

export const handlers = {
  /**
   * run_command: Execute a single shell command and return the output.
   * @param {Record<string, unknown>} params
   * @param {any} env
   * @param {Record<string, unknown>} [runContext]
   */
  async run_command(params, env, runContext = {}) {
    return executeTerminalHandlerRun(env, params, runContext);
  },
};

export const definitions = [
  {
    name: 'run_command',
    description: 'Run a shell command in the terminal and see the results (stdout/stderr)',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute (e.g., ls -la, git status)' },
      },
      required: ['command'],
    },
  },
];
