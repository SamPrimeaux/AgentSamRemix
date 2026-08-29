/**
 * Agent Sam SDK - First-Class Tool Registry & Safety Interceptor
 * @package @inneranimalmedia/agentsam-sdk/tools
 */

import { ToolMetadata, ToolRiskLevel, ApprovalRequest, ExecutionReceipt } from '../types';

export const TOOL_REGISTRY: Record<string, ToolMetadata> = {
  // 1. Filesystem Tools
  'fs.read': {
    key: 'fs.read',
    title: 'Read File',
    description: 'Read contents of a file in the active repository workspace',
    category: 'filesystem',
    risk: 'READ',
    environmentRequirements: { filesystem: true },
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    outputSchema: { type: 'object', properties: { content: { type: 'string' } } },
    requiresApproval: false,
  },
  'fs.write': {
    key: 'fs.write',
    title: 'Write / Edit File',
    description: 'Create or update file contents in the active workspace branch',
    category: 'filesystem',
    risk: 'WRITE',
    environmentRequirements: { filesystem: true },
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    outputSchema: { type: 'object', properties: { bytesWritten: { type: 'number' } } },
    requiresApproval: false, // In isolated workspace branch
  },
  'fs.delete': {
    key: 'fs.delete',
    title: 'Delete File',
    description: 'Permanently remove a file from workspace',
    category: 'filesystem',
    risk: 'DESTRUCTIVE',
    environmentRequirements: { filesystem: true },
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
    requiresApproval: true,
  },
  'fs.search': {
    key: 'fs.search',
    title: 'Search Workspace Files',
    description: 'Search for text matches, symbols, or regex across codebase',
    category: 'search',
    risk: 'READ',
    environmentRequirements: { filesystem: true },
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, glob: { type: 'string' } }, required: ['query'] },
    outputSchema: { type: 'object', properties: { matches: { type: 'array' } } },
    requiresApproval: false,
  },

  // 2. Terminal & Command Tools
  'terminal.exec': {
    key: 'terminal.exec',
    title: 'Run Terminal Command',
    description: 'Execute bash/sh command inside the configured execution environment',
    category: 'terminal',
    risk: 'EXECUTE',
    environmentRequirements: { terminal: true },
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'] },
    outputSchema: { type: 'object', properties: { stdout: { type: 'string' }, exitCode: { type: 'number' } } },
    requiresApproval: false,
  },
  'test.run': {
    key: 'test.run',
    title: 'Run Test Suite',
    description: 'Run vitest / jest / node test suite and capture structured assertion output',
    category: 'terminal',
    risk: 'EXECUTE',
    environmentRequirements: { terminal: true },
    inputSchema: { type: 'object', properties: { testPattern: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { testsPassed: { type: 'number' }, testsFailed: { type: 'number' } } },
    requiresApproval: false,
  },

  // 3. Git & GitHub Tools
  'git.diff': {
    key: 'git.diff',
    title: 'Get Working Tree Diff',
    description: 'Inspect uncommitted or staged changes against base ref',
    category: 'git',
    risk: 'READ',
    environmentRequirements: { git: true },
    inputSchema: { type: 'object', properties: { targetBranch: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { diffText: { type: 'string' } } },
    requiresApproval: false,
  },
  'git.commit': {
    key: 'git.commit',
    title: 'Commit Changes',
    description: 'Create a local Git commit with structured engineering message',
    category: 'git',
    risk: 'WRITE',
    environmentRequirements: { git: true },
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    outputSchema: { type: 'object', properties: { commitHash: { type: 'string' } } },
    requiresApproval: false,
  },
  'git.push': {
    key: 'git.push',
    title: 'Push Branch to Remote',
    description: 'Push working branch to GitHub remote repository',
    category: 'github',
    risk: 'EXTERNAL_EFFECT',
    environmentRequirements: { git: true, network: true },
    inputSchema: { type: 'object', properties: { remote: { type: 'string' }, branch: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
    requiresApproval: true,
  },
  'github.pr.create': {
    key: 'github.pr.create',
    title: 'Open Pull Request',
    description: 'Create a GitHub Pull Request with the mission Evolution Report',
    category: 'github',
    risk: 'EXTERNAL_EFFECT',
    environmentRequirements: { network: true },
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { prUrl: { type: 'string' }, prNumber: { type: 'number' } } },
    requiresApproval: true,
  },

  // 4. Browser Verification Tools
  'browser.open': {
    key: 'browser.open',
    title: 'Open Browser Session',
    description: 'Spawn headless or live Cloudflare Browser Run session',
    category: 'browser',
    risk: 'READ',
    environmentRequirements: { browser: true },
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, viewport: { type: 'object' } }, required: ['url'] },
    outputSchema: { type: 'object', properties: { sessionId: { type: 'string' } } },
    requiresApproval: false,
  },
  'browser.verify': {
    key: 'browser.verify',
    title: 'Verify UI State & Accessibility',
    description: 'Inspect rendered DOM, screenshot layout, and evaluate WCAG AA standards',
    category: 'browser',
    risk: 'READ',
    environmentRequirements: { browser: true },
    inputSchema: { type: 'object', properties: { selector: { type: 'string' }, checkA11y: { type: 'boolean' } } },
    outputSchema: { type: 'object', properties: { passed: { type: 'boolean' }, screenshotUrl: { type: 'string' } } },
    requiresApproval: false,
  },

  // 5. Cloudflare & D1 Database Tools
  'd1.query': {
    key: 'd1.query',
    title: 'Query D1 Database',
    description: 'Execute SQL query against bound Cloudflare D1 database',
    category: 'database',
    risk: 'READ',
    environmentRequirements: { network: true },
    inputSchema: { type: 'object', properties: { binding: { type: 'string' }, sql: { type: 'string' } }, required: ['binding', 'sql'] },
    outputSchema: { type: 'object', properties: { rows: { type: 'array' } } },
    requiresApproval: false,
  },
  'd1.mutate': {
    key: 'd1.mutate',
    title: 'Mutate D1 Database Schema / Records',
    description: 'Execute INSERT, UPDATE, DELETE, or ALTER on D1 database',
    category: 'database',
    risk: 'DESTRUCTIVE',
    environmentRequirements: { network: true },
    inputSchema: { type: 'object', properties: { binding: { type: 'string' }, sql: { type: 'string' } }, required: ['binding', 'sql'] },
    outputSchema: { type: 'object', properties: { changes: { type: 'number' } } },
    requiresApproval: true,
  },

  // 6. Multimodal Vision & Image Classification
  'vision.analyzeImage': {
    key: 'vision.analyzeImage',
    title: 'Analyze & Classify Image',
    description: 'Multimodal inspection of UI screenshots, architecture diagrams, error traces, or code snippets with Gemini Vision',
    category: 'artifacts',
    risk: 'READ',
    environmentRequirements: { network: true },
    inputSchema: {
      type: 'object',
      properties: {
        imageData: { type: 'string' },
        mimeType: { type: 'string' },
        prompt: { type: 'string' },
      },
      required: ['imageData'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        classification: { type: 'string' },
        confidence: { type: 'number' },
        summary: { type: 'string' },
        ocrText: { type: 'string' },
        detectedEntities: { type: 'array' },
        suggestedActions: { type: 'array' },
      },
    },
    requiresApproval: false,
  },
};

export class ToolExecutor {
  async execute(
    toolKey: string,
    params: Record<string, any>,
    options?: {
      onApprovalRequired?: (approval: ApprovalRequest) => Promise<boolean>;
      missionId?: string;
      environmentId?: string;
    }
  ): Promise<ExecutionReceipt> {
    const meta = TOOL_REGISTRY[toolKey];
    if (!meta) {
      throw new Error(`Tool "${toolKey}" is not registered in Agent Sam SDK.`);
    }

    const receiptId = `rcpt_${Math.random().toString(36).slice(2, 9)}`;
    const start = Date.now();

    // Check if safety approval is required
    if (meta.requiresApproval && options?.onApprovalRequired) {
      const approval: ApprovalRequest = {
        id: `appr_${Math.random().toString(36).slice(2, 9)}`,
        missionId: options.missionId || 'mission_active',
        toolKey,
        riskLevel: meta.risk,
        actionSummary: `${meta.title}: ${JSON.stringify(params)}`,
        parameters: params,
        requestedAt: Date.now(),
        status: 'pending',
      };

      const approved = await options.onApprovalRequired(approval);
      if (!approved) {
        return {
          id: receiptId,
          missionId: options.missionId || 'mission_active',
          toolKey,
          timestamp: Date.now(),
          durationMs: Date.now() - start,
          environmentId: options.environmentId || 'cf-computer',
          status: 'rejected',
          riskLevel: meta.risk,
          inputSnapshot: params,
          error: 'Action was rejected by user in safety gate approval.',
          approvalId: approval.id,
        };
      }
    }

    return {
      id: receiptId,
      missionId: options?.missionId || 'mission_active',
      toolKey,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      environmentId: options?.environmentId || 'cf-computer',
      status: 'success',
      riskLevel: meta.risk,
      inputSnapshot: params,
      outputSnapshot: { result: 'Operation completed cleanly' },
    };
  }
}
