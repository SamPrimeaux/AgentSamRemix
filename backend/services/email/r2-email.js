/**
 * Transactional email templates and sent-body archive on ASSETS (inneranimalmedia/email/…).
 * Replaces the retired EMAIL R2 binding (inneranimalmedia-email-archive).
 */

export const EMAIL_R2_PREFIX = 'email/';

/** @param {any} env */
export function getEmailR2Bucket(env) {
  return env?.ASSETS || null;
}

/** @param {any} env */
export function emailR2Ready(env) {
  return !!getEmailR2Bucket(env);
}

export function emailTemplateKey(templateName) {
  return `${EMAIL_R2_PREFIX}templates/${String(templateName || '').trim()}.html`;
}

export function emailArchiveKey(date, messageId) {
  return `${EMAIL_R2_PREFIX}archive/${date}/${messageId}.html`;
}

export function emailSentLogKey(logId) {
  return `${EMAIL_R2_PREFIX}sent/${String(logId || '').trim()}.json`;
}

/**
 * @param {any} env
 * @param {string} logId
 * @returns {Promise<R2ObjectBody | null>}
 */
export async function getEmailSentLogObject(env, logId) {
  const bucket = getEmailR2Bucket(env);
  const id = String(logId || '').trim();
  if (!bucket || !id) return null;
  for (const key of [emailSentLogKey(id), `sent/${id}.json`]) {
    try {
      const obj = await bucket.get(key);
      if (obj) return obj;
    } catch {
      /* try legacy key */
    }
  }
  return null;
}
