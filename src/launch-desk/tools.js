import { tool } from '@openai/agents';
import { z } from 'zod';

function cleanText(value, fallback = '') {
  const text = value == null ? '' : String(value);
  return text.replace(/\s+/g, ' ').trim() || fallback;
}

function normalizeListInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }
  const text = cleanText(value);
  if (!text) return [];
  return text
    .split(/\n|;|•|,|\/+/g)
    .map((part) => part.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);
}

function splitBriefSentences(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function pushUnique(list, value) {
  const text = cleanText(value);
  if (!text || list.includes(text)) return;
  list.push(text);
}

function detectChannels(brief, assets) {
  const haystack = `${brief} ${assets.join(' ')}`.toLowerCase();
  const channels = [];
  if (/(email|newsletter|mailchimp|campaign)/.test(haystack)) channels.push('email');
  if (/(slack|discord|community|teams|workspace)/.test(haystack)) channels.push('slack');
  if (/(blog|post|article|changelog|release note|release notes)/.test(haystack)) channels.push('release-notes');
  if (/(social|x |twitter|linkedin|bluesky|mastodon)/.test(haystack)) channels.push('social');
  if (/(in-app|product tour|banner|modal|announcement bar)/.test(haystack)) channels.push('in-app');
  return channels.length > 0 ? channels : ['email', 'slack', 'release-notes'];
}

function detectOwners(tasks) {
  const ownerOrder = ['Engineering', 'Product', 'Design', 'Marketing', 'Support', 'Legal', 'Ops'];
  const ownerBuckets = new Map(ownerOrder.map((name) => [name, []]));
  for (const task of tasks) {
    const owner = ownerOrder.find((candidate) => task.owner_suggestion === candidate) || 'Product';
    ownerBuckets.get(owner)?.push(task.title);
  }
  return ownerOrder
    .map((owner) => ({ owner, items: ownerBuckets.get(owner) || [] }))
    .filter((entry) => entry.items.length > 0);
}

export function extractLaunchTasks({
  brief,
  audience,
  launchDate,
  constraints,
  availableAssets,
}) {
  const briefText = cleanText(brief);
  const audienceText = cleanText(audience);
  const constraintList = normalizeListInput(constraints);
  const assetList = normalizeListInput(availableAssets);
  const sentences = splitBriefSentences(briefText);
  const lower = `${briefText} ${audienceText} ${constraintList.join(' ')} ${assetList.join(' ')}`.toLowerCase();

  const missingDetails = [];
  if (!briefText) missingDetails.push('Provide a product brief with the launch goal and scope.');
  if (!audienceText) missingDetails.push('Name the primary audience and the secondary audience, if any.');
  if (!cleanText(launchDate)) missingDetails.push('Give the launch date or target launch window.');
  if (constraintList.length === 0) missingDetails.push('List launch constraints, dependencies, or hard no-go items.');
  if (assetList.length === 0) missingDetails.push('List the assets already available: screenshots, docs, landing pages, demos, legal copy, or press materials.');

  const assumptions = [];
  pushUnique(assumptions, /beta|pilot|soft launch/.test(lower) ? 'Assume this is a controlled launch with a limited initial audience.' : 'Assume the launch is a coordinated release, not a fully autonomous ship.');
  if (!/success metric|kpi|metric|north star|goal/.test(lower)) {
    assumptions.push('Assume the team still needs a measurable launch success criterion.');
  }
  if (!/rollback|kill switch|fallback|feature flag/.test(lower)) {
    assumptions.push('Assume a rollback or mitigation plan still needs to be defined.');
  }

  const tasks = [];
  const addTask = (title, priority, owner_suggestion, rationale, dependency_hints = []) => {
    tasks.push({
      id: `task_${tasks.length + 1}`,
      title,
      priority,
      owner_suggestion,
      rationale,
      dependency_hints,
    });
  };

  addTask(
    'Freeze launch scope and success criteria',
    'P0',
    'Product',
    'The brief needs one agreed launch outcome so every downstream decision has a constraint.',
    ['align on what is in scope, what is out of scope, and what success looks like'],
  );
  addTask(
    'Validate launch readiness and rollback path',
    'P0',
    'Engineering',
    'A launch plan is not actionable without a basic go/no-go check and mitigation path.',
    ['release flag, rollback owner, monitoring, QA sign-off'],
  );
  addTask(
    'Confirm audience, channel mix, and CTA',
    'P1',
    'Marketing',
    'Copy and distribution decisions depend on who this is for and how they should respond.',
    ['email, slack, blog, in-app, release notes, press'],
  );
  addTask(
    'Assemble launch-day owner checklist',
    'P0',
    'Ops',
    'Someone needs an hour-by-hour checklist for launch execution and escalation.',
    ['timeline, owner assignments, slack war room, escalation contacts'],
  );
  addTask(
    'Prepare asset inventory and gaps',
    'P1',
    'Design',
    'The available assets determine whether the launch can ship with confidence or needs production work.',
    ['screenshots, demo, landing page, FAQ, screenshots, legal copy'],
  );

  if (/(api|integration|migration|billing|auth|payment|checkout|infra)/.test(lower)) {
    addTask(
      'Stage a dependency and regression check',
      'P0',
      'Engineering',
      'The brief suggests a surface area where hidden dependencies can block the launch.',
      ['upstream/downstream systems, smoke tests, observability'],
    );
  }
  if (/(customer|support|ticket|help center|faq|onboarding)/.test(lower)) {
    addTask(
      'Update support playbooks and FAQ',
      'P1',
      'Support',
      'Customer-facing launches need a support response path before release.',
      ['help center, canned responses, escalation policy'],
    );
  }

  return {
    brief_summary: briefText || 'No brief provided.',
    audience: audienceText || null,
    launch_date: cleanText(launchDate) || null,
    detected_channels: detectChannels(briefText, assetList),
    tasks,
    missing_details: missingDetails,
    assumptions,
    key_keywords: Array.from(
      new Set(
        [...briefText.split(/\W+/g), ...audienceText.split(/\W+/g)]
          .map((word) => word.toLowerCase())
          .filter((word) => word.length > 4)
          .slice(0, 12),
      ),
    ),
    assets: assetList,
    constraints: constraintList,
    suggested_owners: detectOwners(tasks),
  };
}

export function scoreLaunchReadiness({
  brief,
  audience,
  launchDate,
  constraints,
  availableAssets,
}) {
  const briefText = cleanText(brief);
  const audienceText = cleanText(audience);
  const constraintList = normalizeListInput(constraints);
  const assetList = normalizeListInput(availableAssets);
  const lower = `${briefText} ${audienceText} ${constraintList.join(' ')} ${assetList.join(' ')}`.toLowerCase();

  const checks = [
    { key: 'scope', label: 'Scope and goal are named', points: briefText ? 15 : 0, missing: briefText ? null : 'The brief is too thin to plan a launch.' },
    { key: 'audience', label: 'Primary audience is identified', points: audienceText ? 15 : 0, missing: audienceText ? null : 'The audience is unspecified.' },
    { key: 'date', label: 'Launch date or window exists', points: cleanText(launchDate) ? 10 : 0, missing: cleanText(launchDate) ? null : 'No launch date or window.' },
    { key: 'constraints', label: 'Constraints are explicit', points: constraintList.length ? 15 : 0, missing: constraintList.length ? null : 'No constraints listed.' },
    { key: 'assets', label: 'Available assets are enumerated', points: assetList.length ? 10 : 0, missing: assetList.length ? null : 'No assets listed.' },
    { key: 'qa', label: 'QA or validation path is mentioned', points: /(qa|test|validate|smoke|regression)/.test(lower) ? 15 : 0, missing: /(qa|test|validate|smoke|regression)/.test(lower) ? null : 'No validation path mentioned.' },
    { key: 'monitoring', label: 'Monitoring or rollback is planned', points: /(monitor|alert|rollback|flag|kill switch|fallback)/.test(lower) ? 10 : 0, missing: /(monitor|alert|rollback|flag|kill switch|fallback)/.test(lower) ? null : 'No monitoring or rollback path.' },
    { key: 'owners', label: 'Owners or stakeholders are visible', points: /(owner|stakeholder|approver|sign-off|approvals?)/.test(lower) ? 10 : 0, missing: /(owner|stakeholder|approver|sign-off|approvals?)/.test(lower) ? null : 'No owners or approvers listed.' },
  ];

  const score = checks.reduce((sum, check) => sum + check.points, 0);
  const grade = score >= 80 ? 'green' : score >= 60 ? 'yellow' : 'red';
  const missing = checks.map((check) => check.missing).filter(Boolean);
  const risks = [];
  if (score < 80) risks.push('Launch date may be too aggressive for the current level of detail.');
  if (!/(rollback|flag|fallback)/.test(lower)) risks.push('Rollback path is unclear, which increases go/no-go risk.');
  if (!/(support|faq|help center|customer)/.test(lower)) risks.push('Customer support readiness is not documented.');
  if (!/(communication|copy|email|slack|press|announcement)/.test(lower)) risks.push('Launch communications may lag the release.');

  return {
    score,
    grade,
    checks,
    missing,
    risks,
    recommendation:
      grade === 'green'
        ? 'Proceed with a launch plan, but keep a short rollback checklist.'
        : grade === 'yellow'
          ? 'Proceed only after clarifying the missing items and assigning owners.'
          : 'Do not commit to the launch date until the minimum readiness gaps are closed.',
  };
}

export function buildOwnerChecklist({
  brief,
  audience,
  launchDate,
  constraints,
  availableAssets,
  tasks,
}) {
  const extracted = Array.isArray(tasks) && tasks.length > 0 ? tasks : extractLaunchTasks({
    brief,
    audience,
    launchDate,
    constraints,
    availableAssets,
  }).tasks;

  const owners = detectOwners(extracted);
  const ownerSections = owners.map((entry) => {
    const checklist = entry.items.map((item) => ({
      item,
      status: 'pending',
      due: cleanText(launchDate) ? `By ${cleanText(launchDate)}` : 'Before launch',
    }));
    return {
      owner: entry.owner,
      checklist,
    };
  });

  return {
    owners: ownerSections,
    launch_day_sequence: [
      'Confirm go/no-go status and rollback owner.',
      'Publish the launch announcement.',
      'Monitor telemetry, support, and sentiment for the first hour.',
      'Record follow-up actions and decide whether to extend the window.',
    ],
  };
}

export function draftLaunchCopy({
  brief,
  audience,
  launchDate,
  constraints,
  availableAssets,
  channels,
  tone = 'clear, confident, and concrete',
}) {
  const briefText = cleanText(brief);
  const audienceText = cleanText(audience);
  const dateText = cleanText(launchDate, 'launch day');
  const channelList = normalizeListInput(channels);
  const assetList = normalizeListInput(availableAssets);
  const subjectBase = briefText.split(/[\n.?!]/g).find(Boolean)?.slice(0, 60) || 'New launch';

  const buildForChannel = (channel) => {
    const cleanChannel = cleanText(channel, 'email').toLowerCase();
    const assetLine = assetList.length ? `Available assets: ${assetList.slice(0, 3).join(', ')}.` : 'Assets still need to be finalized.';
    if (cleanChannel === 'slack') {
      return {
        channel: 'slack',
        headline: `${subjectBase} is ready for launch`,
        body: `Heads up: ${briefText || 'the launch'} is targeted for ${dateText}. Audience: ${audienceText || 'primary audience TBD'}. ${assetLine} Please confirm owner sign-off and watch for launch-day issues.`,
        cta: 'React with blockers or final approval.',
      };
    }
    if (cleanChannel === 'release-notes') {
      return {
        channel: 'release-notes',
        headline: `${subjectBase}`,
        body: `We are shipping ${briefText || 'this release'} on ${dateText}. This update is intended for ${audienceText || 'the stated audience'} and is aligned to the current constraints: ${normalizeListInput(constraints).join('; ') || 'none listed'}.`,
        cta: 'Read the notes and share any customer-impacting concerns.',
      };
    }
    if (cleanChannel === 'social') {
      return {
        channel: 'social',
        headline: `${subjectBase} goes live`,
        body: `Launching ${briefText || 'the new release'} on ${dateText}. Built for ${audienceText || 'the target audience'} with a plan that keeps the team grounded in the current constraints. ${assetLine}`,
        cta: 'Watch the launch and share feedback.',
      };
    }
    if (cleanChannel === 'in-app') {
      return {
        channel: 'in-app',
        headline: `New: ${subjectBase}`,
        body: `You are seeing this because ${briefText || 'this release'} is available to ${audienceText || 'the target audience'} starting ${dateText}.`,
        cta: 'Explore the new experience.',
      };
    }
    return {
      channel: 'email',
      subject: `${subjectBase} launches ${dateText}`,
      body: `We are launching ${briefText || 'this release'} for ${audienceText || 'the target audience'} on ${dateText}. Tone: ${tone}. ${assetLine}`,
      cta: 'Review the release and confirm approval.',
    };
  };

  return {
    tone,
    channels: channelList.length > 0 ? channelList : ['email', 'slack', 'release-notes'],
    drafts: (channelList.length > 0 ? channelList : ['email', 'slack', 'release-notes']).map(buildForChannel),
  };
}

export const launchDeskTools = [
  tool({
    name: 'extract_launch_tasks',
    description: 'Extract launch-critical tasks, assumptions, missing details, and likely owners from the brief.',
    parameters: z.object({
      brief: z.string().describe('The product or feature brief.'),
      audience: z.string().optional().describe('Primary audience for the launch.'),
      launchDate: z.string().optional().describe('Planned launch date or window.'),
      constraints: z.union([z.array(z.string()), z.string()]).optional().describe('Launch constraints, one per line or as a list.'),
      availableAssets: z.union([z.array(z.string()), z.string()]).optional().describe('Existing assets or collateral.'),
    }),
    execute: async (args) => extractLaunchTasks(args),
  }),
  tool({
    name: 'check_launch_readiness',
    description: 'Score launch readiness against a lightweight rubric and surface gaps and risks.',
    parameters: z.object({
      brief: z.string().describe('The product or feature brief.'),
      audience: z.string().optional().describe('Primary audience for the launch.'),
      launchDate: z.string().optional().describe('Planned launch date or window.'),
      constraints: z.union([z.array(z.string()), z.string()]).optional().describe('Launch constraints.'),
      availableAssets: z.union([z.array(z.string()), z.string()]).optional().describe('Existing assets or collateral.'),
    }),
    execute: async (args) => scoreLaunchReadiness(args),
  }),
  tool({
    name: 'build_owner_checklist',
    description: 'Build an owner-by-owner launch checklist from the plan and readiness context.',
    parameters: z.object({
      brief: z.string().describe('The product or feature brief.'),
      audience: z.string().optional().describe('Primary audience for the launch.'),
      launchDate: z.string().optional().describe('Planned launch date or window.'),
      constraints: z.union([z.array(z.string()), z.string()]).optional().describe('Launch constraints.'),
      availableAssets: z.union([z.array(z.string()), z.string()]).optional().describe('Existing assets or collateral.'),
      tasks: z.array(z.object({
        id: z.string(),
        title: z.string(),
        priority: z.enum(['P0', 'P1', 'P2']),
        owner_suggestion: z.string(),
        rationale: z.string(),
        dependency_hints: z.array(z.string()).optional(),
      })).optional(),
    }),
    execute: async (args) => buildOwnerChecklist(args),
  }),
  tool({
    name: 'draft_launch_copy',
    description: 'Draft channel-specific launch copy suggestions for common launch surfaces.',
    parameters: z.object({
      brief: z.string().describe('The product or feature brief.'),
      audience: z.string().optional().describe('Primary audience for the launch.'),
      launchDate: z.string().optional().describe('Planned launch date or window.'),
      constraints: z.union([z.array(z.string()), z.string()]).optional().describe('Launch constraints.'),
      availableAssets: z.union([z.array(z.string()), z.string()]).optional().describe('Existing assets or collateral.'),
      channels: z.union([z.array(z.string()), z.string()]).describe('One or more launch channels to draft for.'),
      tone: z.string().optional().describe('Desired copy tone.'),
    }),
    execute: async (args) => draftLaunchCopy(args),
  }),
];
