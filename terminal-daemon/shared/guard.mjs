/**
 * ExecOS shared output redaction. Owner exec (/run) skips command blocklist —
 * EXECOS_KEY is the trust boundary. HARD_BLOCKS kept for future customer targets.
 */

import { checkSudoPolicy } from "./sudo-allowlist.mjs";

export const HARD_BLOCKS = [
  { pattern: /cat\s+~\/(\.(zshrc|bashrc|bash_profile|zprofile|profile|netrc|npmrc))/i, reason: 'blocked: reading shell config' },
  { pattern: /cat\s+~\/.env/i, reason: 'blocked: reading env file' },
  { pattern: /cat\s+~\/.ssh\//i, reason: 'blocked: reading SSH directory' },
  { pattern: /cat\s+~\/.aws\//i, reason: 'blocked: reading AWS credentials' },
  { pattern: /cat\s+.*\.(pem|key|p12|pfx|crt|cer)(\s|$)/i, reason: 'blocked: reading certificate file' },
  { pattern: /^\s*printenv\s*$/i, reason: 'blocked: printing all env vars' },
  { pattern: /^\s*env\s*$/i, reason: 'blocked: printing all env vars' },
  { pattern: /^\s*set\s*$/i, reason: 'blocked: printing all shell vars' },
  { pattern: /export\s+-p/i, reason: 'blocked: printing exported vars' },
  { pattern: /echo\s+['"]*\$\{?(TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|API)[A-Z0-9_]*\}?/i, reason: 'blocked: echoing secret variable' },
  { pattern: /\bsu\s+-/i, reason: 'blocked: su not permitted' },
  { pattern: /base64\s+(-d|--decode)\s*\|/i, reason: 'blocked: base64 decode piped to execution' },
  { pattern: /curl[^#\n]+\|\s*(bash|sh|zsh|python3?|ruby|perl|node)/i, reason: 'blocked: curl piped to shell' },
  { pattern: /wget[^#\n]+\|\s*(bash|sh|zsh|python3?|ruby|perl|node)/i, reason: 'blocked: wget piped to shell' },
  { pattern: /rm\s+(-rf?|-fr?)\s+(~|\/)\s*$/i, reason: 'blocked: destructive rm on root' },
  { pattern: /rm\s+(-rf?|-fr?)\s+~\//i, reason: 'blocked: destructive rm on home' },
  { pattern: />\s*\/etc\//i, reason: 'blocked: writing to /etc' },
  { pattern: /\bnc\s+.*-l/i, reason: 'blocked: netcat listener' },
  { pattern: /mkfifo/i, reason: 'blocked: named pipe' },
  { pattern: /\/dev\/tcp\//i, reason: 'blocked: TCP redirection' },
  { pattern: /\/etc\/passwd/i, reason: 'blocked: reading passwd' },
  { pattern: /\/etc\/shadow/i, reason: 'blocked: reading shadow' },
  { pattern: /\/etc\/sudoers/i, reason: 'blocked: reading sudoers' },
  { pattern: /crontab\s+-[er]/i, reason: 'blocked: crontab modification' },
];

/**
 * @param {string} cmd
 * @returns {{ blocked: true, reason: string } | { blocked: false }}
 */
export function checkCommandGuards(cmd) {
  const trimmed = String(cmd || '').trim();
  for (const { pattern, reason } of HARD_BLOCKS) {
    if (pattern.test(trimmed)) {
      return { blocked: true, reason };
    }
  }
  const sudo = checkSudoPolicy(trimmed);
  if (!sudo.ok) {
    return { blocked: true, reason: sudo.reason };
  }
  return { blocked: false };
}

export const OUTPUT_REDACT = [
  { re: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|API_KEY)[A-Z0-9_]*)\s*=\s*(['"]?)(\S+)\2/g, replace: '$1=[REDACTED]' },
  { re: /\b(sk-[a-zA-Z0-9]{20,})/g, replace: '[OPENAI_KEY_REDACTED]' },
  { re: /\b(sk-ant-[a-zA-Z0-9\-]{20,})/g, replace: '[ANTHROPIC_KEY_REDACTED]' },
  { re: /\b(ghp_[a-zA-Z0-9]{36})/g, replace: '[GITHUB_TOKEN_REDACTED]' },
  { re: /\b(eyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,})\b/g, replace: '[JWT_REDACTED]' },
];

export function sanitizeOutput(text) {
  if (!text) return text;
  let out = text;
  for (const { re, replace } of OUTPUT_REDACT) {
    out = out.replace(re, replace);
  }
  return out;
}

export function logSecurityEvent(type, cmd, reason) {
  console.log('[EXECOS-SECURITY]', JSON.stringify({
    ts: new Date().toISOString(),
    type,
    cmd: String(cmd).slice(0, 120),
    reason,
  }));
}
