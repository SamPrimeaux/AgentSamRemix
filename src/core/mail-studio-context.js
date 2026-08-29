/**
 * Compact Collaborate Mail context for Agent Sam chat.
 */

/**
 * @param {unknown} browserContext
 * @param {unknown} body
 * @returns {Record<string, unknown>|null}
 */
export function extractMailSurfaceContext(browserContext, body) {
  const fromBrowser =
    browserContext && typeof browserContext === 'object'
      ? /** @type {Record<string, unknown>} */ (browserContext).mailContext
      : null;
  const fromBody =
    body && typeof body === 'object'
      ? /** @type {Record<string, unknown>} */ (body).mailContext
      : null;
  const raw =
    fromBrowser && typeof fromBrowser === 'object'
      ? fromBrowser
      : fromBody && typeof fromBody === 'object'
        ? fromBody
        : null;
  if (!raw || raw.surface !== 'mail') return null;
  return raw;
}

/**
 * @param {Record<string, unknown>|null|undefined} raw
 * @returns {string|null}
 */
export function formatMailSurfaceContextForAgent(raw) {
  if (!raw || typeof raw !== 'object' || raw.surface !== 'mail') return null;

  const folder = String(raw.folder || 'inbox');
  const account = raw.account != null ? String(raw.account).trim() : '';
  const search = raw.search != null ? String(raw.search).trim() : '';
  const preview = Array.isArray(raw.inboxPreview)
    ? raw.inboxPreview.slice(0, 30).map((row) => {
        const r = /** @type {Record<string, unknown>} */ (row || {});
        return {
          id: r.id != null ? String(r.id) : undefined,
          subject: String(r.subject || ''),
          from: String(r.from || r.from_address || ''),
          date: r.date != null ? String(r.date) : r.date_received != null ? String(r.date_received) : undefined,
          is_read: r.is_read,
        };
      })
    : [];

  const lines = [
    '[Mail — live surface context. The user is on Collaborate Mail. The inbox snapshot below is metadata only (subject/from/date). Before triage conclusions on Stripe, security, or OAuth items: call gmail_list_inbox then gmail_get_message for each candidate message id (snippets are not enough). For count/search-by-sender questions: call gmail_list_inbox (or agentsam_gmail_mcp_search_threads), then count from results — NEVER agentsam_d1_query / D1 schema discovery for inbox questions. Never claim you cannot read inbox without calling those tools.]',
    `folder: ${folder}`,
    `account: ${account || '(all connected)'}`,
    `gmail_connected: ${raw.gmailConnected !== false}`,
  ];
  if (search) lines.push(`search_filter: ${search}`);

  const selected = raw.selected;
  if (selected && typeof selected === 'object') {
    const s = /** @type {Record<string, unknown>} */ (selected);
    lines.push(
      'selected_email (user has this message open in Mail UI):',
      s.id ? `message_id: ${String(s.id)}` : '',
      s.account ? `account: ${String(s.account)}` : '',
      `from: ${String(s.from || '')}`,
      `subject: ${String(s.subject || '')}`,
      s.to ? `to: ${String(s.to)}` : '',
      s.bodyPreview ? `body_preview:\n${String(s.bodyPreview).slice(0, 3000)}` : '',
      s.id
        ? 'For full body: gmail_get_message({ message_id }) — preview alone is not enough for triage conclusions.'
        : '',
    );
  }

  if (preview.length) {
    lines.push(`inbox_preview (${preview.length} messages):`, JSON.stringify(preview));
  }

  lines.push(
    'mail_tools: gmail_list_inbox, gmail_get_message (full body), gmail_modify_message, gmail_send, agentsam_gmail_mcp_search_threads, agentsam_gmail_mcp_get_thread (OAuth user-scoped). Do not use agentsam_d1_query for mailbox questions.',
  );

  return lines.filter(Boolean).join('\n');
}
