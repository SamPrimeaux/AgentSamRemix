import { Think } from '@cloudflare/think';
import { createExecuteTool } from '@cloudflare/think/tools/execute';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Env } from '../../src/env';
import { executeOnDefaultVm, getHostExecStatus } from './host-exec';

export class AgentSam extends Think<Env> {
  getAIBinding() {
    return this.env.AGENTSAM_WAI;
  }

  getModel() {
    return this.env.AGENTSAM_MODEL || '@cf/moonshotai/kimi-k2.7-code';
  }

  getSystemPrompt() {
    return `You are Agent Sam inside AgentSamRemix, a compact Cloudflare-native engineering workbench.

Operate like a capable software engineering agent, not a chat-only assistant. Inspect before editing, keep changes focused, run relevant checks, and report concrete results.

You have two execution scopes:
1. Your durable Think workspace filesystem for scratch work and artifacts.
2. host_exec for real ExecOS VM work. Use host_exec when the user asks you to inspect, edit, test, build, or git-operate on a real repository. Always set cwd to the actual repository path once discovered.

The unified execute tool gives you Code Mode. Prefer it for multi-step filesystem/tool/browser work so intermediate data stays inside the execution sandbox. Browser access is via CDP. On every new page, check whether WebMCP APIs are available (navigator.modelContext or navigator.modelContextTesting); if available, prefer structured WebMCP tools and re-list tools after state changes. Otherwise use CDP/DOM interaction.

Never claim a command, test, browser action, edit, or commit succeeded unless its tool result confirms it.`;
  }

  getTools(): ToolSet {
    const hostStatus = tool({
      description: 'Check whether the private ExecOS VM lane is available for real repository and terminal work.',
      inputSchema: z.object({}),
      execute: async () => getHostExecStatus(this.env),
    });

    const hostExec = tool({
      description: 'Execute a command on the authenticated private ExecOS VM. Use for real repo inspection, edits, tests, builds, git and Wrangler operations. The VM daemon enforces cwd and command policy.',
      inputSchema: z.object({
        command: z.string().min(1).max(24000),
        cwd: z.string().min(1).max(2048).optional(),
      }),
      execute: async ({ command, cwd }) => executeOnDefaultVm(this.env, command, { cwd }),
    });

    const domainTools: ToolSet = {
      host_status: hostStatus,
      host_exec: hostExec,
    };

    return {
      ...domainTools,
      execute: createExecuteTool(this, {
        tools: domainTools,
        browser: this.env.BROWSER as any,
        loader: this.env.LOADER,
        timeout: 45_000,
        globalOutbound: null,
      }),
    };
  }
}
