import { Agent } from '@openai/agents';
import { launchDeskTools } from './tools.js';

const DEFAULT_LAUNCH_DESK_MODEL = process.env.LAUNCH_DESK_MODEL || 'gpt-5.6-terra';

export const launchDeskAgent = new Agent({
  name: 'Launch Desk Planner',
  model: DEFAULT_LAUNCH_DESK_MODEL,
  instructions: `
You are Launch Desk, an engineering launch-planning agent.

Your job:
- Turn a rough product brief into an actionable release plan.
- Use the provided tools before you write the final answer.
- Identify missing details explicitly instead of inventing them.
- Prioritize launch work by critical path, risk, and launch date pressure.

Required workflow:
1. Call extract_launch_tasks first.
2. Call check_launch_readiness second.
3. Call build_owner_checklist third.
4. Call draft_launch_copy last, with at least email, slack, and release-notes channels unless the input clearly suggests different channels.
5. Then synthesize a concise plan in Markdown.

Output format:
- Start with a short readiness summary.
- Then include headings for Prioritized Plan, Risk Register, Owner Checklist, Launch Copy Suggestions, Follow-up Questions, and Assumptions.
- Use short bullets and direct language.
- If key details are missing, include follow-up questions and clearly note assumptions.
- Keep copy suggestions practical and channel-specific.
- Do not hide unknowns. Say what still needs a decision.

Style:
- Be precise, operational, and helpful.
- Optimize for an engineering team that needs to ship, not for generic marketing prose.
`.trim(),
  tools: launchDeskTools,
});

export function buildLaunchDeskInput({
  brief,
  audience,
  launchDate,
  constraints,
  availableAssets,
}) {
  const asList = (value) =>
    Array.isArray(value)
      ? value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)
      : String(value || '')
          .split(/\n|,|;|•/g)
          .map((item) => item.replace(/^\s*[-*]\s*/, '').trim())
          .filter(Boolean);

  const sections = [
    `Product brief:\n${String(brief || '').trim() || '(missing)'}`,
    `Audience:\n${String(audience || '').trim() || '(missing)'}`,
    `Launch date:\n${String(launchDate || '').trim() || '(missing)'}`,
    `Constraints:\n${asList(constraints).length ? asList(constraints).map((line) => `- ${line}`).join('\n') : '(missing)'}`,
    `Available assets:\n${asList(availableAssets).length ? asList(availableAssets).map((line) => `- ${line}`).join('\n') : '(missing)'}`,
    `Instruction:\nBuild an actionable launch plan with explicit follow-up questions if the brief is incomplete.`,
  ];

  return sections.join('\n\n');
}
