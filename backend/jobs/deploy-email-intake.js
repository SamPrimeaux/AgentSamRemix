/**
 * Rule-based intake for IAM deploy notification emails — no LLM required.
 */

const DEPLOY_FROM_RE = /notifications@inneranimalmedia\.com|inneranimals\.com/i;
const DEPLOY_SUBJ_RE = /agent sam deployed/i;

/**
 * @param {{ subject?: string, from_address?: string, snippet?: string }} email
 */
export function isDeployNotificationEmail(email) {
  const sub = String(email?.subject || '');
  const from = String(email?.from_address || email?.from || '');
  return DEPLOY_SUBJ_RE.test(sub) || DEPLOY_FROM_RE.test(from);
}

/**
 * @param {string} htmlOrText
 */
function stripHtml(htmlOrText) {
  return String(htmlOrText || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 */
export function parseDeployEmailFacts(text) {
  const t = stripHtml(text);
  const facts = {
    deploy_sha: null,
    branch: null,
    environment: null,
    latest_commit_message: null,
    commits: [],
    files_changed: [],
    r2_sync: null,
    bundle: null,
  };

  const subjSha = t.match(/\b([0-9a-f]{7,40})\b/i);
  const headSha = t.match(/LATEST CHANGE[\s\S]*?([0-9a-f]{7,40})\s*·/i);
  facts.deploy_sha = (headSha?.[1] || subjSha?.[1] || '').slice(0, 12) || null;

  const branchM = t.match(/\bmain\b|\bproduction\b/i);
  facts.branch = branchM ? 'main' : null;
  facts.environment = /production/i.test(t) ? 'production' : null;

  const latestM = t.match(/LATEST CHANGE\s+(.+?)\s+[0-9a-f]{7,40}\s*·/i);
  if (latestM) facts.latest_commit_message = latestM[1].trim().slice(0, 500);

  const commitBlock = t.match(/RECENT COMMITS([\s\S]*?)(?:FILES CHANGED|RECOMMENDED|$)/i);
  if (commitBlock) {
    const lines = commitBlock[1].split(/\n|(?=[0-9a-f]{7,}\s)/);
    for (const line of lines) {
      const m = line.trim().match(/^([0-9a-f]{7,40})\s+(.+)$/i);
      if (m) facts.commits.push({ hash: m[1], message: m[2].trim().slice(0, 300) });
    }
  }

  const filesM = t.match(/FILES CHANGED\s*\((\d+)/i);
  if (filesM) facts.files_changed_count = Number(filesM[1]);

  const fileLines = [...t.matchAll(/(?:▸|⚙|⬡|◈|◻)\s+[\w /]+\(\d+\)|\s{2,}([\w./-]+\.(?:js|sql|tsx|ts|mjs|sh|jsonc?))/gi)];
  for (const m of fileLines) {
    const f = (m[1] || '').trim();
    if (f && !facts.files_changed.includes(f)) facts.files_changed.push(f);
  }

  if (/R2 Sync[\s\S]*?passed/i.test(t)) facts.r2_sync = 'passed';
  const bundleM = t.match(/Bundle[\s\S]*?(\d+)\s*files\s*·\s*([\d.]+)\s*KB/i);
  if (bundleM) facts.bundle = `${bundleM[1]} files · ${bundleM[2]} KB`;

  return facts;
}

/**
 * @param {{ id?: string, subject?: string, from_address?: string, snippet?: string, body?: string }} email
 */
export function triageDeployNotificationEmail(email) {
  const subject = String(email.subject || '').trim();
  const raw = [email.body, email.snippet, subject].filter(Boolean).join('\n');
  const facts = parseDeployEmailFacts(raw);

  const shaM = subject.match(/\b([0-9a-f]{7,40})\b/i);
  const sha = facts.deploy_sha || (shaM ? shaM[1].slice(0, 12) : '');
  const msg =
    facts.latest_commit_message ||
    facts.commits[0]?.message ||
    subject.replace(/agent sam deployed[^]*/i, '').trim();

  const summary = sha
    ? `Deploy ${sha}: ${(msg || 'production deploy').slice(0, 120)}`
    : `Deploy notification: ${subject.slice(0, 120)}`;

  return {
    ...email,
    triage: {
      label: 'updates',
      summary,
      needs_action: false,
      urgency: 'normal',
      project_tag: 'platform_deploy',
      suggested_action: 'archive',
      reason: 'Verified deploy notification — structured parse, no LLM',
      source: 'deploy_email_parser',
      verified: true,
      facts,
    },
  };
}
