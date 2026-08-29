/**
 * Canonical MCP input schema for agentsam_plan (tools/list).
 * Keep in sync with inneranimalmedia-mcp-server/src/mcp-plan-schema.js
 */

export const DEFAULT_PLAN_GOAL = 'Create a structured execution plan';
export const DEFAULT_PLAN_TYPE = 'daily';

/** @type {ReadonlySet<string>} */
export const PLAN_TYPES = new Set(['daily', 'sprint', 'incident', 'feature', 'refactor']);

export function normalizeMcpPlanType(raw) {
  const s = String(raw ?? '')
    .toLowerCase()
    .trim();
  if (PLAN_TYPES.has(s)) return s;
  return DEFAULT_PLAN_TYPE;
}

/** @type {Record<string, unknown>} */
export const CANONICAL_AGENTSAM_PLAN_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    goal: {
      type: 'string',
      description:
        'Goal to create a structured execution plan for. Defaults to a general planning goal when omitted.',
    },
    context: {
      type: 'string',
      description: 'Optional extra context.',
    },
    read: {
      type: 'boolean',
      description:
        'When true, read the latest active plan and tasks instead of creating a new plan.',
    },
    title: {
      type: 'string',
      description: 'Optional plan title when creating (defaults from goal).',
    },
  },
  additionalProperties: false,
};

/** @returns {Record<string, unknown>} */
export function agentsamPlanInputSchema() {
  return { ...CANONICAL_AGENTSAM_PLAN_INPUT_SCHEMA, properties: { ...CANONICAL_AGENTSAM_PLAN_INPUT_SCHEMA.properties } };
}
