/**
 * Transactional email templates.
 * All functions return { subject, html, text }.
 * No hardcoded domain — pass absolute URLs from request origin/env.
 */

export function verifyEmailTemplate({ name, verifyUrl, baseUrl }) {
  const subject = 'Verify your IAM account';
  const html = `
    <div style="font-family:monospace;max-width:520px;margin:0 auto;padding:32px;
                background:#00212b;color:#b0c4ce;border:1px solid #1e3e4a;">
      <div style="color:#2dd4bf;font-size:18px;font-weight:500;margin-bottom:24px;">
        Inner Animal Media
      </div>
      <p style="margin:0 0 16px;">Hey ${name || 'there'},</p>
      <p style="margin:0 0 24px;">Verify your email to activate your account.</p>
      <a href="${verifyUrl}"
         style="display:inline-block;padding:10px 24px;background:#2dd4bf;
                color:#00212b;text-decoration:none;font-weight:500;border-radius:4px;">
        Verify email
      </a>
      <p style="margin:24px 0 0;font-size:12px;color:#4a6a7a;">
        Link expires in 24 hours. If you didn't create an account, ignore this.
      </p>
      <p style="margin:10px 0 0;font-size:11px;color:#4a6a7a;">
        ${baseUrl ? `Sent from ${baseUrl}` : ''}
      </p>
    </div>`;
  const text = `Verify your IAM account\n\nHey ${name || 'there'},\n\nVerify your email:\n${verifyUrl}\n\nExpires in 24 hours.`;
  return { subject, html, text };
}

export function welcomeEmailTemplate({ name, dashboardUrl }) {
  const subject = 'Welcome to Inner Animal Media';
  const html = `
    <div style="font-family:monospace;max-width:520px;margin:0 auto;padding:32px;
                background:#00212b;color:#b0c4ce;border:1px solid #1e3e4a;">
      <div style="color:#2dd4bf;font-size:18px;font-weight:500;margin-bottom:24px;">
        Inner Animal Media
      </div>
      <p style="margin:0 0 16px;">Hey ${name || 'there'}, you're in.</p>
      <p style="margin:0 0 24px;">Your account is verified and your workspace is ready.</p>
      <a href="${dashboardUrl}"
         style="display:inline-block;padding:10px 24px;background:#2dd4bf;
                color:#00212b;text-decoration:none;font-weight:500;border-radius:4px;">
        Open dashboard
      </a>
    </div>`;
  const text = `Welcome to Inner Animal Media\n\nYou're in. Open your dashboard:\n${dashboardUrl}`;
  return { subject, html, text };
}

export function resetPasswordTemplate({ name, resetUrl }) {
  const subject = 'Reset your IAM password';
  const html = `
    <div style="font-family:monospace;max-width:520px;margin:0 auto;padding:32px;
                background:#00212b;color:#b0c4ce;border:1px solid #1e3e4a;">
      <div style="color:#2dd4bf;font-size:18px;font-weight:500;margin-bottom:24px;">
        Inner Animal Media
      </div>
      <p style="margin:0 0 16px;">Hey ${name || 'there'},</p>
      <p style="margin:0 0 24px;">Click below to reset your password. Expires in 1 hour.</p>
      <a href="${resetUrl}"
         style="display:inline-block;padding:10px 24px;background:#2dd4bf;
                color:#00212b;text-decoration:none;font-weight:500;border-radius:4px;">
        Reset password
      </a>
      <p style="margin:24px 0 0;font-size:12px;color:#4a6a7a;">
        Didn't request this? Ignore it — your password hasn't changed.
      </p>
    </div>`;
  const text = `Reset your IAM password\n\nReset link (expires 1 hour):\n${resetUrl}`;
  return { subject, html, text };
}
