/**
 * Daily Code Activity — scoped GitHub facts for the Human Ops digest.
 * Deterministic metrics only; narrative synthesis belongs to daily-memory.
 */
import { getUserGithubToken } from '../integrations/github.js';
import {
  normalizeGithubRepoFullName,
  readProjectGithubRepoFromRow,
} from '../../backend/agentsam/codebase/project-github-repo.js';

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'InnerAnimalMedia-DailyCodeActivity/1.0',
};
const MAX_REPOS = 6;
const MAX_COMMIT_PAGES = 3;
const SESSION_GAP_MS = 90 * 60_000;

function subjectOf(row) {
  return String(row?.commit?.message || row?.message || '').split('\n')[0].trim();
}
function timeOf(row) {
  const raw = row?.commit?.committer?.date || row?.commit?.author?.date || row?.committed_at || null;
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : null;
}
export function classifyCommitMode(subject) {
  const s = String(subject || '').toLowerCase();
  if (/^(fix|bugfix|hotfix)(\(|:|\b)/.test(s) || /\b(fix|repair|regression|crash|broken|failure)\b/.test(s)) return 'repair';
  if (/^refactor(\(|:|\b)/.test(s) || /\b(refactor|peel|modular|converge|extract|split)\b/.test(s)) return 'architecture';
  if (/^feat(\(|:|\b)/.test(s) || /\b(add|introduce|implement|build)\b/.test(s)) return 'feature';
  if (/^docs(\(|:|\b)/.test(s)) return 'docs';
  if (/^(chore|ci|build|test)(\(|:|\b)/.test(s)) return 'maintenance';
  return 'other';
}
export function classifySubsystemText(value) {
  const s = String(value || '').toLowerCase();
  if (/\bcms\b|site[-_ ]?deploy|studio-cms|cms[-_/]/.test(s)) return 'cms';
  if (/terminal|pty|execos|shell|ssh|localpty|iam-tunnel/.test(s)) return 'terminal';
  if (/gemini|agent|model|llm|chat|spawn|inference|prompt/.test(s)) return 'agent-ai';
  if (/d1|database|supabase|postgres|sql|migration|vector|rag|index/.test(s)) return 'data';
  if (/deploy|wrangler|cloudflare|worker|cron|queue|ops|infra/.test(s)) return 'deploy-ops';
  if (/mail|email|gmail|resend|calendar|human[-_ ]?ops/.test(s)) return 'human-ops';
  if (/marketing|london|railway|campaign|seo/.test(s)) return 'marketing';
  if (/image|video|media|meshy|veo|moviemode/.test(s)) return 'media';
  if (/script|tool|mcp|guard|audit|test|package|deps/.test(s)) return 'tooling';
  if (/docs|readme|\.md$/.test(s)) return 'docs';
  return 'other';
}
function rank(map) {
  return Object.entries(map || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
}
function sessionStats(commits) {
  const times = commits.map(timeOf).filter(Number.isFinite).sort((a, b) => a - b);
  if (!times.length) return { sessions: 0, active_minutes: 0, observed_span_minutes: 0 };
  let sessions = 1;
  let start = times[0];
  let previous = times[0];
  let active = 0;
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] - previous > SESSION_GAP_MS) {
      active += (previous - start) / 60_000 + 30;
      sessions += 1;
      start = times[i];
    }
    previous = times[i];
  }
  active += (previous - start) / 60_000 + 30;
  return {
    sessions,
    active_minutes: Math.round(active),
    observed_span_minutes: Math.round((times[times.length - 1] - times[0]) / 60_000),
  };
}
export function summarizeDailyCodeRepo({ repo = null, commits = [], files = [] } = {}) {
  const modeCounts = {};
  const subsystemCommits = {};
  const subsystemChurn = {};
  let switches = 0;
  let previous = null;
  for (const row of [...commits].reverse()) {
    const subject = subjectOf(row);
    const mode = classifyCommitMode(subject);
    const subsystem = classifySubsystemText(subject);
    modeCounts[mode] = (modeCounts[mode] || 0) + 1;
    subsystemCommits[subsystem] = (subsystemCommits[subsystem] || 0) + 1;
    if (previous && previous !== subsystem) switches += 1;
    previous = subsystem;
  }
  let insertions = 0;
  let deletions = 0;
  let churn = 0;
  const hotFiles = [];
  for (const row of files) {
    const additions = Number(row?.additions) || 0;
    const removed = Number(row?.deletions) || 0;
    const changes = Number(row?.changes) || additions + removed;
    const path = String(row?.filename || row?.path || '').trim();
    const subsystem = classifySubsystemText(path);
    insertions += additions;
    deletions += removed;
    churn += changes;
    subsystemChurn[subsystem] = (subsystemChurn[subsystem] || 0) + changes;
    hotFiles.push({ path, additions, deletions: removed, churn: changes, subsystem });
  }
  hotFiles.sort((a, b) => b.churn - a.churn);
  const count = commits.length;
  const names = new Set([...Object.keys(subsystemCommits), ...Object.keys(subsystemChurn)]);
  const scores = {};
  for (const name of names) {
    const commitShare = count ? (subsystemCommits[name] || 0) / count : 0;
    const churnShare = churn ? (subsystemChurn[name] || 0) / churn : 0;
    scores[name] = Math.round((commitShare * 0.4 + churnShare * 0.6) * 1000) / 10;
  }
  const ranked = rank(scores);
  const primary = ranked[0]?.[0] || 'none';
  const secondary = ranked[1]?.[0] || null;
  const session = sessionStats(commits);
  const summary = {
    repo,
    commits: count,
    unique_files: files.length,
    insertions,
    deletions,
    churn,
    net_lines: insertions - deletions,
    deletion_share_pct: churn ? Math.round((deletions / churn) * 1000) / 10 : 0,
    mode_counts: modeCounts,
    mode_share_pct: Object.fromEntries(Object.entries(modeCounts).map(([k, v]) => [k, count ? Math.round(v / count * 1000) / 10 : 0])),
    subsystem_commits: subsystemCommits,
    subsystem_churn: subsystemChurn,
    focus_score_pct: scores,
    primary_focus: { name: primary, score_pct: scores[primary] || 0, commits: subsystemCommits[primary] || 0, churn: subsystemChurn[primary] || 0 },
    secondary_focus: secondary ? { name: secondary, score_pct: scores[secondary] || 0, commits: subsystemCommits[secondary] || 0, churn: subsystemChurn[secondary] || 0 } : null,
    context_switches: switches,
    context_switches_per_10_commits: count ? Math.round(switches / count * 1000) / 100 : 0,
    commit_sessions: session.sessions,
    estimated_active_minutes: session.active_minutes,
    observed_span_minutes: session.observed_span_minutes,
    hot_files: hotFiles.slice(0, 12),
    recent_commits: commits.slice(0, 20).map((row) => {
      const sha = String(row?.sha || '').trim();
      return {
        sha,
        subject: subjectOf(row),
        committed_at: timeOf(row) ? new Date(timeOf(row)).toISOString() : null,
      };
    }),
  };
  summary.signals = deriveDailyCodeSignals(summary);
  return summary;
}

/**
 * Evidence-derived labels for the digest. Not labor-time tracking.
 * @param {object} metrics
 */
export function deriveDailyCodeSignals(metrics) {
  const commits = Math.max(0, Number(metrics?.commits) || 0);
  const churn = Number(metrics?.churn) || 0;
  const net = Number(metrics?.net_lines) || 0;
  const deletions = Number(metrics?.deletions) || 0;
  const deletionShare =
    Number(metrics?.deletion_share_pct) ||
    (churn ? Math.round((deletions / churn) * 1000) / 10 : 0);
  const modeShare = metrics?.mode_share_pct || {};
  const repair = Number(modeShare.repair) || 0;
  const architecture = Number(modeShare.architecture) || 0;
  const feature = Number(modeShare.feature) || 0;

  let change_shape = 'no measured change';
  if (commits > 0 || churn > 0) {
    if (net < 0 && churn >= 5000) change_shape = 'high transformation with a smaller codebase at the end';
    else if (Math.abs(net) <= Math.max(100, churn * 0.03)) {
      change_shape = 'high transformation with roughly flat codebase size';
    } else if (net > 0) change_shape = 'net expansion';
    else change_shape = 'net simplification';
  }

  let work_mode = 'mixed';
  if (repair >= 45) work_mode = 'repair-heavy';
  else if (architecture >= 30) work_mode = 'architecture-heavy';
  else if (feature >= 30) work_mode = 'feature-heavy';

  const per10 = Number(metrics?.context_switches_per_10_commits) || 0;
  let focus_shape = 'fairly concentrated';
  if (per10 >= 6) focus_shape = 'highly interleaved';
  else if (per10 >= 3) focus_shape = 'moderately interleaved';

  return {
    change_shape,
    deletion_share_pct: deletionShare,
    work_mode,
    repair_share_pct: repair,
    architecture_share_pct: architecture,
    feature_share_pct: feature,
    focus_shape,
    context_switches_per_10_commits: per10,
  };
}

function fmtMinutes(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h && rem) return `${h}h ${rem}m`;
  if (h) return `${h}h`;
  return `${rem}m`;
}

function titleCaseSubsystem(name) {
  return String(name || 'none').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function displaySha(sha) {
  const full = String(sha || '').trim();
  return full.length > 12 ? full.slice(0, 12) : full;
}

/**
 * Deterministic markdown for ### Your Day in Code. Quote these numbers; do not invent.
 * @param {object} activity
 */
export function renderDailyCodeActivityMarkdown(activity) {
  if (!activity?.available) {
    const reason = String(activity?.reason || 'unavailable').trim();
    return `_Day in Code facts unavailable (${reason})._`;
  }
  const signals = activity.signals || deriveDailyCodeSignals(activity);
  const primary = titleCaseSubsystem(activity.primary_focus?.name);
  const secondary = activity.secondary_focus?.name
    ? titleCaseSubsystem(activity.secondary_focus.name)
    : null;
  const lines = [
    `**Primary mission:** ${primary} — ${activity.primary_focus?.commits || 0} commits · ${Number(activity.primary_focus?.churn || 0).toLocaleString()} lines churn · focus ${activity.primary_focus?.score_pct || 0}%`,
  ];
  if (secondary) {
    lines.push(
      `**Secondary:** ${secondary} — ${activity.secondary_focus.commits || 0} commits · ${Number(activity.secondary_focus.churn || 0).toLocaleString()} lines churn`,
    );
  }
  lines.push(
    '',
    `${activity.commits || 0} commits touched ${activity.unique_files || 0} files and transformed ${Number(activity.churn || 0).toLocaleString()} lines. Net ${Number(activity.net_lines || 0) >= 0 ? '+' : ''}${Number(activity.net_lines || 0).toLocaleString()} lines: ${signals.change_shape}.`,
    '',
    `**Work mode:** ${signals.work_mode} — repair ${signals.repair_share_pct}% · architecture ${signals.architecture_share_pct}% · feature ${signals.feature_share_pct}%.`,
    `**Focus:** ${activity.commit_sessions || 0} commit sessions · ~${fmtMinutes(activity.estimated_active_minutes)} Git-derived active-time estimate · ${activity.context_switches || 0} subsystem switches (${signals.context_switches_per_10_commits}/10 commits): ${signals.focus_shape}.`,
  );
  const hot = (activity.hot_files || [])[0];
  if (hot?.path) {
    lines.push(
      '',
      `**Hottest file:** ${hot.repo ? `${hot.repo}:` : ''}${hot.path} — ${Number(hot.churn || 0).toLocaleString()} lines churn.`,
    );
  }
  const subsystems = Object.entries(activity.subsystem_commits || {}).slice(0, 8);
  if (subsystems.length) {
    lines.push('', '**Subsystems**');
    for (const [name, count] of subsystems) {
      lines.push(`- ${name}: ${count} commits`);
    }
  }
  const recents = (activity.recent_commits || []).slice(0, 8);
  if (recents.length) {
    lines.push('', '**Recent commits**');
    for (const row of recents) {
      const sha = displaySha(row.sha);
      lines.push(`- ${sha} ${row.subject || ''}`.trim());
    }
  }
  lines.push(
    '',
    '_Evidence-derived from GitHub commits in scoped repos. Active time and context switching are estimates, not labor-time tracking._',
  );
  return lines.join('\n');
}

/**
 * Compact facts for Gemini synthesis (no raw compare payloads).
 * @param {object} activity
 */
export function dailyCodeActivityForDigest(activity) {
  if (!activity?.available) {
    return {
      available: false,
      reason: String(activity?.reason || 'unavailable'),
      markdown: renderDailyCodeActivityMarkdown(activity),
    };
  }
  const recent = [];
  for (const summary of activity.repo_summaries || []) {
    for (const row of summary.recent_commits || []) {
      recent.push({
        repo: summary.repo || null,
        sha: row.sha,
        subject: row.subject,
        committed_at: row.committed_at || null,
      });
      if (recent.length >= 12) break;
    }
    if (recent.length >= 12) break;
  }
  const compact = {
    available: true,
    window_hours: activity.window_hours,
    repos: activity.repos || [],
    commits: activity.commits || 0,
    unique_files: activity.unique_files || 0,
    insertions: activity.insertions || 0,
    deletions: activity.deletions || 0,
    churn: activity.churn || 0,
    net_lines: activity.net_lines || 0,
    deletion_share_pct: activity.deletion_share_pct || 0,
    estimated_active_minutes: activity.estimated_active_minutes || 0,
    commit_sessions: activity.commit_sessions || 0,
    context_switches: activity.context_switches || 0,
    context_switches_per_10_commits: activity.context_switches_per_10_commits || 0,
    mode_share_pct: activity.mode_share_pct || {},
    subsystem_commits: activity.subsystem_commits || {},
    primary_focus: activity.primary_focus || null,
    secondary_focus: activity.secondary_focus || null,
    signals: activity.signals || deriveDailyCodeSignals(activity),
    hot_files: (activity.hot_files || []).slice(0, 8).map((file) => ({
      repo: file.repo || null,
      path: file.path,
      churn: file.churn,
    })),
    recent_commits: recent,
  };
  compact.markdown = renderDailyCodeActivityMarkdown(compact);
  return compact;
}
async function githubJson(fetchImpl, token, path) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`github_daily_code_${response.status}`);
    error.status = response.status;
    error.detail = detail.slice(0, 500);
    throw error;
  }
  return response.json();
}
async function fetchCommitsSince(fetchImpl, token, repo, sinceIso) {
  const rows = [];
  for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
    const path = `/repos/${encodeURI(repo)}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}`;
    const batch = await githubJson(fetchImpl, token, path);
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}
async function fetchCompareFiles(fetchImpl, token, repo, commits) {
  if (!commits.length) return [];
  const newest = commits[0];
  const oldest = commits[commits.length - 1];
  const base = oldest?.parents?.[0]?.sha || oldest?.sha;
  const head = newest?.sha;
  if (!base || !head) return [];
  if (base === head) {
    const one = await githubJson(fetchImpl, token, `/repos/${encodeURI(repo)}/commits/${encodeURIComponent(head)}`);
    return Array.isArray(one?.files) ? one.files : [];
  }
  const compare = await githubJson(fetchImpl, token, `/repos/${encodeURI(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  return Array.isArray(compare?.files) ? compare.files : [];
}
export async function resolveDailyCodeRepos(env, scope, { limit = MAX_REPOS } = {}) {
  const repos = new Set();
  const workspaceIds = Array.isArray(scope?.workspaceIds)
    ? scope.workspaceIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (!env?.DB || !workspaceIds.length) return [...repos].slice(0, limit);
  const placeholders = workspaceIds.map(() => '?').join(',');
  const workspaceRows = await env.DB.prepare(
    `SELECT id, github_repo FROM agentsam_workspace
     WHERE id IN (${placeholders}) AND COALESCE(status, 'active') = 'active'`,
  ).bind(...workspaceIds).all().catch(() => ({ results: [] }));
  for (const row of workspaceRows?.results || []) {
    const repo = normalizeGithubRepoFullName(row?.github_repo);
    if (repo) repos.add(repo);
  }
  const projectRows = await env.DB.prepare(
    `SELECT id, workspace_id, metadata_json FROM projects
     WHERE workspace_id IN (${placeholders})
     ORDER BY updated_at DESC LIMIT 50`,
  ).bind(...workspaceIds).all().catch(() => ({ results: [] }));
  for (const row of projectRows?.results || []) {
    const repo = readProjectGithubRepoFromRow(row);
    if (repo) repos.add(repo);
    if (repos.size >= limit) break;
  }
  return [...repos].slice(0, limit);
}
function aggregateRepoSummaries(summaries, hours) {
  const good = summaries.filter((summary) => summary && summary.ok !== false);
  const aggregate = {
    window_hours: hours,
    repos: good.map((summary) => summary.repo).filter(Boolean),
    repo_count: good.length,
    commits: 0,
    unique_files: 0,
    insertions: 0,
    deletions: 0,
    churn: 0,
    net_lines: 0,
    estimated_active_minutes: 0,
    commit_sessions: 0,
    context_switches: 0,
    mode_counts: {},
    subsystem_commits: {},
    subsystem_churn: {},
    hot_files: [],
    repo_summaries: good,
    errors: summaries.filter((summary) => summary?.ok === false),
  };
  const uniquePaths = new Set();
  for (const summary of good) {
    aggregate.commits += summary.commits || 0;
    aggregate.insertions += summary.insertions || 0;
    aggregate.deletions += summary.deletions || 0;
    aggregate.churn += summary.churn || 0;
    aggregate.estimated_active_minutes += summary.estimated_active_minutes || 0;
    aggregate.commit_sessions += summary.commit_sessions || 0;
    aggregate.context_switches += summary.context_switches || 0;
    for (const [key, value] of Object.entries(summary.mode_counts || {})) aggregate.mode_counts[key] = (aggregate.mode_counts[key] || 0) + Number(value || 0);
    for (const [key, value] of Object.entries(summary.subsystem_commits || {})) aggregate.subsystem_commits[key] = (aggregate.subsystem_commits[key] || 0) + Number(value || 0);
    for (const [key, value] of Object.entries(summary.subsystem_churn || {})) aggregate.subsystem_churn[key] = (aggregate.subsystem_churn[key] || 0) + Number(value || 0);
    for (const file of summary.hot_files || []) {
      uniquePaths.add(`${summary.repo}:${file.path}`);
      aggregate.hot_files.push({ ...file, repo: summary.repo });
    }
  }
  aggregate.unique_files = uniquePaths.size;
  aggregate.net_lines = aggregate.insertions - aggregate.deletions;
  aggregate.deletion_share_pct = aggregate.churn ? Math.round(aggregate.deletions / aggregate.churn * 1000) / 10 : 0;
  aggregate.hot_files.sort((a, b) => b.churn - a.churn);
  aggregate.hot_files = aggregate.hot_files.slice(0, 15);
  const totalCommits = aggregate.commits || 1;
  const totalChurn = aggregate.churn || 1;
  const names = new Set([...Object.keys(aggregate.subsystem_commits), ...Object.keys(aggregate.subsystem_churn)]);
  const scores = {};
  for (const name of names) {
    scores[name] = Math.round((((aggregate.subsystem_commits[name] || 0) / totalCommits * 0.4) + ((aggregate.subsystem_churn[name] || 0) / totalChurn * 0.6)) * 1000) / 10;
  }
  const ranked = rank(scores);
  const primary = ranked[0]?.[0] || 'none';
  const secondary = ranked[1]?.[0] || null;
  aggregate.focus_score_pct = scores;
  aggregate.primary_focus = { name: primary, score_pct: scores[primary] || 0, commits: aggregate.subsystem_commits[primary] || 0, churn: aggregate.subsystem_churn[primary] || 0 };
  aggregate.secondary_focus = secondary ? { name: secondary, score_pct: scores[secondary] || 0, commits: aggregate.subsystem_commits[secondary] || 0, churn: aggregate.subsystem_churn[secondary] || 0 } : null;
  aggregate.mode_share_pct = Object.fromEntries(Object.entries(aggregate.mode_counts).map(([key, value]) => [key, Math.round(Number(value || 0) / totalCommits * 1000) / 10]));
  aggregate.context_switches_per_10_commits = aggregate.commits ? Math.round(aggregate.context_switches / aggregate.commits * 1000) / 100 : 0;
  aggregate.signals = deriveDailyCodeSignals(aggregate);
  return aggregate;
}
export async function collectDailyCodeActivity(env, scope, opts = {}) {
  const hours = Math.min(168, Math.max(1, Math.trunc(Number(opts.hours) || 24)));
  const userId = String(scope?.userId || '').trim();
  if (!userId) return { available: false, reason: 'user_id_required', window_hours: hours };
  const tokenRow = await getUserGithubToken(env, userId).catch(() => null);
  if (!tokenRow?.token) return { available: false, reason: 'github_not_connected', window_hours: hours };
  const repos = await resolveDailyCodeRepos(env, scope, { limit: opts.maxRepos || MAX_REPOS });
  if (!repos.length) return { available: false, reason: 'no_scoped_github_repos', window_hours: hours };
  const fetchImpl = opts.fetchImpl || fetch;
  const sinceIso = new Date(Date.now() - hours * 3_600_000).toISOString();
  const summaries = [];
  for (const repo of repos) {
    try {
      const commits = await fetchCommitsSince(fetchImpl, tokenRow.token, repo, sinceIso);
      const files = commits.length ? await fetchCompareFiles(fetchImpl, tokenRow.token, repo, commits) : [];
      summaries.push({ ...summarizeDailyCodeRepo({ repo, commits, files }), ok: true });
    } catch (error) {
      summaries.push({ ok: false, repo, error: String(error?.message || error), status: Number(error?.status) || null });
    }
  }
  const aggregate = aggregateRepoSummaries(summaries, hours);
  return {
    available: aggregate.repo_count > 0,
    reason: aggregate.repo_count > 0 ? null : 'github_activity_unavailable',
    generated_at: new Date().toISOString(),
    source: 'github_api',
    scope: {
      user_id: userId,
      tenant_id: scope?.tenantId || null,
      workspace_ids: Array.isArray(scope?.workspaceIds) ? scope.workspaceIds : [],
    },
    ...aggregate,
  };
}
