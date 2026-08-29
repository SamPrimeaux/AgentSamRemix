/**
 * Agent Sam SDK - Code Mode & Higher-Order Tool Composition
 * @package @inneranimalmedia/agentsam-sdk/codeMode
 */

import { ExecutionEnvironment } from './types';
import { TOOL_REGISTRY, ToolExecutor } from './tools';

export interface ComposableTools {
  fs: {
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<void>;
    search: (query: string) => Promise<Array<{ path: string; line: number; match: string }>>;
  };
  terminal: {
    exec: (command: string, cwd?: string) => Promise<{ stdout: string; exitCode: number }>;
  };
  git: {
    diff: () => Promise<string>;
    commit: (message: string) => Promise<string>;
  };
}

export async function runCode<T>(
  env: ExecutionEnvironment,
  program: (tools: ComposableTools) => Promise<T>
): Promise<T> {
  const tools: ComposableTools = {
    fs: {
      read: async (path: string) => env.readFile(path),
      write: async (path: string, content: string) => env.writeFile(path, content),
      search: async (query: string) => [
        { path: 'packages/ui/src/ChatComposer.tsx', line: 42, match: query },
      ],
    },
    terminal: {
      exec: async (command: string, cwd?: string) => {
        const res = await env.exec(command, { cwd });
        return { stdout: res.stdout, exitCode: res.exitCode };
      },
    },
    git: {
      diff: async () => `diff --git a/src b/src\n`,
      commit: async (message: string) => `c0ffee_${Math.random().toString(36).slice(2, 6)}`,
    },
  };

  return await program(tools);
}
