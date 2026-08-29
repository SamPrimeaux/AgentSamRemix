import { insertEmailLog } from '../services/email/email-log.js';

/**
 * Operator Resend notification + email_logs (cron / spend alerts).
 * Entry is `src/index.js` — there is no tracked `worker.js` monolith anymore.
 *
 * Subject placeholders `{repo}` / `{branch}` are substituted only when the
 * matching Worker env var is set (`GITHUB_REPO`, `GIT_BRANCH`). No invented
 * defaults — if you change the deploy branch, set `GIT_BRANCH` (or omit
 * `{branch}` from the subject) so emails never lie.
 *
 * @param {any} env
 * @param {{ subject?: string, body?: string, category?: string, to?: string }} opts
 * @param {ExecutionContext | null} executionCtx
 */
export async function notifyOperator(env, opts, executionCtx) {
  const subjectRaw = String(opts.subject || '')
    .replace(/[\r\n\t]/g, ' ')
    .trim();
  const bodyRaw = String(opts.body || '').trim();
  const category = String(opts.category || 'notice').trim();
  const toAddr = opts.to || env.RESEND_TO || '';
  const fromAddr = typeof env.RESEND_FROM === 'string' && env.RESEND_FROM.trim() ? env.RESEND_FROM.trim() : '';
  if (!fromAddr) return null;
  const prefix = subjectRaw.startsWith('[Agent Sam]') ? '' : '[Agent Sam] ';
  let subject = `${prefix}${subjectRaw}`.slice(0, 400);

  const repoPlaceholder =
    typeof env.GITHUB_REPO === 'string' && env.GITHUB_REPO.trim() ? env.GITHUB_REPO.trim() : '';
  const branchPlaceholder =
    typeof env.GIT_BRANCH === 'string' && env.GIT_BRANCH.trim() ? env.GIT_BRANCH.trim() : '';
  if (repoPlaceholder) {
    subject = subject.replace(/\{repo\}/g, repoPlaceholder);
  }
  if (branchPlaceholder) {
    subject = subject.replace(/\{branch\}/g, branchPlaceholder);
  }
  subject = subject.slice(0, 400);

  const run = async () => {
    if (!env.RESEND_API_KEY) {
      console.warn('[notifyOperator] RESEND_API_KEY not set', category);
      return;
    }
    if (!toAddr) {
      console.warn('[notifyOperator] RESEND_TO not set', category);
      return;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromAddr,
          to: [toAddr],
          subject,
          text: bodyRaw,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (env.DB) {
        await insertEmailLog(env, {
          to: toAddr,
          from: fromAddr,
          subject,
          status: res.ok ? 'sent' : 'failed',
          externalMessageId: json.id ?? null,
          provider: 'resend',
        });
      }
      if (!res.ok) console.warn('[notifyOperator] Resend', res.status, JSON.stringify(json).slice(0, 400));
    } catch (e) {
      console.warn('[notifyOperator]', e?.message ?? e);
    }
  };
  if (executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(run());
  } else {
    await run();
  }
}
