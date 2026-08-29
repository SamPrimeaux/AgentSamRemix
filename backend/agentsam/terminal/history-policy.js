/**
 * Lines injected to seed shell history (print -s / history -s) must never round-trip into D1 input history.
 * @param {string} line
 */
export function isShellHistorySeedLine(line) {
  const t = String(line || '').replace(/[\r\n]+$/, '').trim();
  if (!t) return true;
  if (/^print\s+-s\b/i.test(t)) return true;
  if (/^history\s+-s\b/i.test(t)) return true;
  if (/^Add-History\b/i.test(t)) return true;
  if (/\x1b\[[0-9;]*200~|\x1b\[[0-9;]*201~|\[200~|\[201~/.test(t)) return true;
  if (t.length > 2000) return true;
  if ((t.match(/print\s+-s/gi) || []).length > 0) return true;
  if ((t.match(/\\'/g) || []).length > 6) return true;
  return false;
}

/**
 * Heuristic: skip persisting terminal input that likely contains secrets/tokens.
 * Fail closed — better to drop a line than store a key.
 * @param {string} line
 */
export function looksLikeSecretTerminalLine(line) {
  const t = String(line || '');
  if (!t.trim()) return false;
  if (
    /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret|bearer)\s*[=:]\s*\S+/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/export\s+[A-Za-z_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY)[A-Za-z_]*\s*=/i.test(t)) {
    return true;
  }
  if (
    /\b(?:sk-[a-zA-Z0-9_-]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(?:CLOUDFLARE_API_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|NPM_TOKEN|HF_TOKEN|SUPABASE_SERVICE_ROLE)\b/i.test(
      t,
    ) &&
    /[=:\s]\S{8,}/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} line
 */
export function shouldSkipTerminalHistoryInput(line) {
  return isShellHistorySeedLine(line) || looksLikeSecretTerminalLine(line);
}
