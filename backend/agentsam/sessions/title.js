/**
 * Chat session title derivation — placeholder detection and first-message titles.
 *
 * @module backend/agentsam/sessions/title
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'i', 'you', 'he', 'she', 'it', 'we',
  'they', 'my', 'your', 'me', 'us', 'them', 'this', 'that', 'these', 'those', 'please', 'hey', 'hi',
]);

/** Titles that should be upgraded when the first real user message arrives. */
export function isPlaceholderChatSessionTitle(title) {
  const t = String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return !t || t === 'chat' || t === 'new chat' || t === 'agent chat';
}

/**
 * @param {string} message
 * @returns {string}
 */
export function deriveChatSessionTitle(message) {
  const raw = String(message || '').trim();
  if (!raw) return 'New Chat';

  const cleaned = raw.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(Boolean);
  if (!words.length) return 'New Chat';

  const meaningful = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const pool = meaningful.length >= 3 ? meaningful : words;
  const capped = pool.slice(0, 8).map((w) => {
    const lower = w.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });

  let selected = [...capped];
  while (selected.length > 1 && selected.join(' ').length > 40) {
    selected.pop();
  }
  let title = selected.join(' ');
  if (title.length > 40) title = title.slice(0, 40).trim();

  return title || 'New Chat';
}
