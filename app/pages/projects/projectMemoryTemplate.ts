/** Blank AGENTSAM-style scaffold when a project has no saved memory yet. */
export function defaultProjectMemoryDraft(projectName?: string | null, projectId?: string | null): string {
  const name = (projectName || 'Project').trim() || 'Project';
  const idLine = projectId?.trim() ? `Project ID: ${projectId.trim()}` : 'Project ID:';
  return `# AGENTSAM.md — ${name}

> Agent Sam project memory — fill in for this build. Only visible on the project page.

## Identity

\`\`\`
Client / product:
Public domain:
Worker:
Workspace:
${idLine}
GitHub repo:
Local path:
\`\`\`

## What this project is

(one paragraph)

## Stack (bindings)

- Worker:
- D1:
- R2:
- KV:

## Non-negotiables

-

## Deploy

\`\`\`

\`\`\`

## Open gaps

-
`;
}

export const PROJECT_MEMORY_PLACEHOLDER =
  'Fill in identity, stack, deploy path, and non-negotiables (AGENTSAM.md style)…';
