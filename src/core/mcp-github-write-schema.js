/**
 * Canonical MCP input schema for agentsam_github_write (tools/list).
 * Code wins at runtime; D1 agentsam_tools.input_schema kept in sync via migration.
 */

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_GITHUB_WRITE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'File path in the repo (e.g. docs/readme.md).',
    },
    content: {
      type: 'string',
      description: 'Full file content (UTF-8 text).',
    },
    message: {
      type: 'string',
      description: 'Git commit message.',
    },
    sha: {
      type: 'string',
      description:
        'Optional — include only when updating and you already have it from agentsam_github_read. Omit entirely for new files.',
    },
    branch: {
      type: 'string',
      description: 'Target branch. Required — do not assume main.',
    },
    repo: {
      type: 'string',
      description: 'owner/repo for your connected GitHub account. Required — never inferred from a workspace.',
    },
    operation: {
      type: 'string',
      enum: ['create', 'update', 'upsert'],
      default: 'upsert',
      description:
        'create: new path only. update: existing path (sha recommended). upsert: create or update (default).',
    },
  },
  required: ['path', 'content', 'message', 'repo', 'branch'],
  additionalProperties: false,
};

/** @returns {Record<string, unknown>} */
export function agentsamGithubWriteInputSchema() {
  return {
    ...CANONICAL_AGENTSAM_GITHUB_WRITE_INPUT_SCHEMA,
    properties: { ...CANONICAL_AGENTSAM_GITHUB_WRITE_INPUT_SCHEMA.properties },
    required: [...CANONICAL_AGENTSAM_GITHUB_WRITE_INPUT_SCHEMA.required],
  };
}

/** Map MCP operation hint → handler_config operation string. */
export function githubWriteOperationFromArgs(raw) {
  const op = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (op === 'create') return 'create_file';
  if (op === 'update') return 'update_file';
  if (op === 'upsert') return 'upsert_file';
  return '';
}
