/**
 * Canonical MCP input schema for agentsam_github_commit_tree (tools/list).
 */

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_GITHUB_COMMIT_TREE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    repo: {
      type: 'string',
      description: 'owner/repo for your connected GitHub account. Required — never inferred from a workspace.',
    },
    message: {
      type: 'string',
      description: 'Single commit message for all files in this tree.',
    },
    files: {
      type: 'array',
      description: 'UTF-8 text files to include in one atomic commit (max 50).',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Path in the repo' },
          content: { type: 'string', description: 'Full UTF-8 file content' },
        },
        required: ['path', 'content'],
      },
    },
    branch: {
      type: 'string',
      description: 'Target branch. Required — do not assume main.',
    },
  },
  required: ['repo', 'message', 'files', 'branch'],
  additionalProperties: false,
};

/** @returns {Record<string, unknown>} */
export function agentsamGithubCommitTreeInputSchema() {
  return {
    ...CANONICAL_AGENTSAM_GITHUB_COMMIT_TREE_INPUT_SCHEMA,
    properties: {
      ...CANONICAL_AGENTSAM_GITHUB_COMMIT_TREE_INPUT_SCHEMA.properties,
      files: {
        ...CANONICAL_AGENTSAM_GITHUB_COMMIT_TREE_INPUT_SCHEMA.properties.files,
        items: {
          ...CANONICAL_AGENTSAM_GITHUB_COMMIT_TREE_INPUT_SCHEMA.properties.files.items,
          properties: {
            ...CANONICAL_AGENTSAM_GITHUB_COMMIT_TREE_INPUT_SCHEMA.properties.files.items.properties,
          },
        },
      },
    },
    required: [...CANONICAL_AGENTSAM_GITHUB_COMMIT_TREE_INPUT_SCHEMA.required],
  };
}
