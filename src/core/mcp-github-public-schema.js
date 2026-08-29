/**
 * Public MCP schemas for GitHub read / PR / issue (in-app catalog overlay).
 * Twin: inneranimalmedia-mcp-server/src/mcp-github-public-schema.js
 */

export const AGENTSAM_GITHUB_READ_DESCRIPTION =
  'Read a file from GitHub using your connected GitHub account. Requires explicit owner/repo and path.';

export const AGENTSAM_GITHUB_PR_DESCRIPTION =
  'Open a pull request using your connected GitHub account. Requires explicit owner/repo, title, head, and base.';

export const AGENTSAM_GITHUB_ISSUE_DESCRIPTION =
  'Create or manage GitHub issues using your connected GitHub account. Requires explicit owner/repo.';

const REPO_PROP = {
  type: 'string',
  description: 'owner/repo for your connected GitHub account. Required — never inferred from a workspace.',
};

function cloneSchema(schema) {
  return {
    ...schema,
    required: [...(schema.required || [])],
    properties: { ...schema.properties },
  };
}

export function agentsamGithubReadInputSchema() {
  return cloneSchema({
    type: 'object',
    additionalProperties: false,
    required: ['path', 'repo'],
    properties: {
      path: { type: 'string', description: 'File path in the repository.' },
      repo: REPO_PROP,
      ref: { type: 'string', description: 'Optional branch, tag, or commit SHA.' },
      branch: { type: 'string', description: 'Alias for ref.' },
      max_bytes: {
        type: 'number',
        description: 'Max UTF-8 bytes to return. Omit to use the server default.',
      },
      byte_offset: {
        type: 'number',
        description: 'Resume offset in UTF-8 bytes after a truncated read.',
      },
    },
  });
}

export function agentsamGithubPrInputSchema() {
  return cloneSchema({
    type: 'object',
    additionalProperties: false,
    required: ['title', 'head', 'base', 'repo'],
    properties: {
      title: { type: 'string', description: 'PR title.' },
      body: { type: 'string', description: 'PR description.' },
      head: { type: 'string', description: 'Branch with the changes.' },
      base: { type: 'string', description: 'Target branch. Required — do not assume main.' },
      repo: REPO_PROP,
      draft: { type: 'boolean', description: 'Open as a draft PR.' },
    },
  });
}

export function agentsamGithubIssueInputSchema() {
  return cloneSchema({
    type: 'object',
    additionalProperties: false,
    required: ['operation', 'repo'],
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'get', 'list', 'close', 'update'],
        description: 'Issue operation.',
      },
      title: { type: 'string' },
      body: { type: 'string' },
      labels: { type: 'array', items: { type: 'string' } },
      issue_number: { type: 'integer' },
      state: { type: 'string', enum: ['open', 'closed', 'all'] },
      repo: REPO_PROP,
    },
  });
}
