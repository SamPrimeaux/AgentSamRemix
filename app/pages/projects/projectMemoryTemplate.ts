/**
 * Minimal manual escape hatch for project context.
 * Machine-readable state (repo paths, routes, tables, Workers, buckets, bindings)
 * must come from its live authority instead of being copied into this document.
 */
export function defaultProjectMemoryDraft(projectName?: string | null, projectId?: string | null): string {
  const name = (projectName || 'Project').trim() || 'Project';
  void projectId;
  return `# Project context — ${name}

> Optional human context. Keep only meaning that live project/repo/infrastructure sources cannot reliably infer.

## Intent

-

## Decisions

-

## Constraints

-

## Current blockers

-

## Notes

-
`;
}

export const PROJECT_MEMORY_PLACEHOLDER =
  'Add non-inferable project context: intent, decisions, constraints, blockers, or notes…';
