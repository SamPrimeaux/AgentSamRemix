import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyCommitMode,
  classifySubsystemText,
  dailyCodeActivityForDigest,
  deriveDailyCodeSignals,
  renderDailyCodeActivityMarkdown,
  summarizeDailyCodeRepo,
} from './daily-code-activity.js';

function commit(sha, subject, iso) {
  return {
    sha,
    commit: { message: subject, committer: { date: iso } },
    parents: [{ sha: `${sha}-parent` }],
  };
}

test('classifies work mode without treating every chore as feature work', () => {
  assert.equal(classifyCommitMode('fix(terminal): stop websocket crash'), 'repair');
  assert.equal(classifyCommitMode('refactor(cms): establish pages domain'), 'architecture');
  assert.equal(classifyCommitMode('feat(human-ops): add recap'), 'feature');
  assert.equal(classifyCommitMode('chore(deps): prune SDKs'), 'maintenance');
});

test('classifies CMS and terminal paths as distinct work domains', () => {
  assert.equal(classifySubsystemText('src/core/agentsam/cms/pages/service.js'), 'cms');
  assert.equal(classifySubsystemText('backend/agentsam/terminal/websocket.js'), 'terminal');
  assert.equal(classifySubsystemText('scripts/git_activity_audit.py'), 'tooling');
});

test('primary focus blends commit share with churn share', () => {
  const commits = [
    commit('a1', 'fix(terminal): one', '2026-08-14T20:00:00Z'),
    commit('a2', 'fix(terminal): two', '2026-08-14T19:50:00Z'),
    commit('a3', 'fix(terminal): three', '2026-08-14T19:40:00Z'),
    commit('b1', 'refactor(cms): pages', '2026-08-14T19:20:00Z'),
    commit('b2', 'refactor(cms): sections', '2026-08-14T18:20:00Z'),
  ];
  const files = [
    { filename: 'src/core/agentsam/cms/pages/service.js', additions: 4000, deletions: 3000, changes: 7000 },
    { filename: 'backend/agentsam/terminal/websocket.js', additions: 80, deletions: 20, changes: 100 },
  ];
  const out = summarizeDailyCodeRepo({ repo: 'owner/repo', commits, files });
  assert.equal(out.commits, 5);
  assert.equal(out.churn, 7100);
  assert.equal(out.primary_focus.name, 'cms');
  assert.equal(out.secondary_focus.name, 'terminal');
  assert.equal(out.mode_counts.repair, 3);
  assert.equal(out.mode_counts.architecture, 2);
});

test('reports simplification when deletions exceed insertions', () => {
  const out = summarizeDailyCodeRepo({
    repo: 'owner/repo',
    commits: [commit('x1', 'refactor(cms): peel facade', '2026-08-14T20:00:00Z')],
    files: [{ filename: 'src/api/cms.js', additions: 100, deletions: 1200, changes: 1300 }],
  });
  assert.equal(out.net_lines, -1100);
  assert.ok(out.deletion_share_pct > 90);
  assert.equal(out.hot_files[0].path, 'src/api/cms.js');
});

test('estimates commit sessions without claiming literal labor time', () => {
  const out = summarizeDailyCodeRepo({
    repo: 'owner/repo',
    commits: [
      commit('a', 'feat(cms): one', '2026-08-14T20:00:00Z'),
      commit('b', 'feat(cms): two', '2026-08-14T19:30:00Z'),
      commit('c', 'fix(terminal): three', '2026-08-14T14:00:00Z'),
    ],
    files: [],
  });
  assert.equal(out.commit_sessions, 2);
  assert.ok(out.estimated_active_minutes > 0);
  assert.equal(out.context_switches, 1);
});

test('keeps full git SHAs on commit facts', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const out = summarizeDailyCodeRepo({
    repo: 'owner/repo',
    commits: [commit(sha, 'fix(data): keep full sha', '2026-08-14T20:00:00Z')],
    files: [],
  });
  assert.equal(out.recent_commits[0].sha, sha);
  assert.equal(out.recent_commits[0].sha.length, 40);
});

test('repair-heavy days get a work-mode signal from mode share', () => {
  const out = summarizeDailyCodeRepo({
    repo: 'owner/repo',
    commits: [
      commit('1', 'fix(terminal): a', '2026-08-14T20:00:00Z'),
      commit('2', 'fix(terminal): b', '2026-08-14T19:50:00Z'),
      commit('3', 'chore(deps): c', '2026-08-14T19:40:00Z'),
    ],
    files: [],
  });
  assert.equal(out.signals.work_mode, 'repair-heavy');
  const derived = deriveDailyCodeSignals(out);
  assert.equal(derived.work_mode, 'repair-heavy');
});

test('digest compact facts include markdown and unavailable reason', () => {
  const missing = dailyCodeActivityForDigest({ available: false, reason: 'github_not_connected' });
  assert.equal(missing.available, false);
  assert.match(missing.markdown, /github_not_connected/);
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const summary = summarizeDailyCodeRepo({
    repo: 'SamPrimeaux/inneranimalmedia',
    commits: [commit(sha, 'feat(human-ops): recap', '2026-08-14T20:00:00Z')],
    files: [{ filename: 'backend/jobs/daily-memory-pipeline.js', additions: 40, deletions: 10, changes: 50 }],
  });
  const digest = dailyCodeActivityForDigest({
    ...summary,
    available: true,
    ok: true,
    repos: ['SamPrimeaux/inneranimalmedia'],
    repo_summaries: [{ repo: 'SamPrimeaux/inneranimalmedia', recent_commits: summary.recent_commits }],
    hot_files: summary.hot_files.map((file) => ({ ...file, repo: 'SamPrimeaux/inneranimalmedia' })),
  });
  assert.equal(digest.available, true);
  assert.equal(digest.recent_commits[0].sha, sha);
  assert.match(digest.markdown, /Primary mission/);
  assert.match(renderDailyCodeActivityMarkdown(digest), /50/);
});
