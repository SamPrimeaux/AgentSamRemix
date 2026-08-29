export const SLUG_TO_LABEL: Record<string, string> = {
  general: 'General',
  agents: 'Agents',
  'ai-models': 'AI Models',
  tools: 'Tools & MCP',
  rules: 'Rules & Skills',
  workspace: 'Workspace',
  design: 'Brand & Design',
  hooks: 'Hooks',
  github: 'GitHub',
  indexrules: 'Index Rules',
  cicd: 'CI/CD',
  network: 'Network',
  themes: 'Themes',
  storage: 'Storage',
  security: 'Security',
  keys: 'Keys & Secrets',
  billing: 'Plan & Usage',
  notifications: 'Notifications',
  docs: 'Docs',
  integrations: 'Integrations',
};

export const LABEL_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TO_LABEL).map(([k, v]) => [v, k]),
);

export const DEFAULT_SLUG = 'general';
export const DEFAULT_LABEL = 'General';
