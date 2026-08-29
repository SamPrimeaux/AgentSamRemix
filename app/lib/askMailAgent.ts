import { IAM_AGENT_CHAT_NEW_THREAD } from '../agentChatConstants';

export type MailInboxPreview = {
  id?: string;
  subject: string;
  from: string;
  date?: string;
  is_read?: number;
};

export type MailAgentFocus = {
  id?: string;
  subject: string;
  from: string;
  to?: string;
  account?: string;
  bodyPreview?: string;
};

/** Open Agent Sam side rail on Mail with optional inbox/email context (replaces in-page triage pane). */
export function openMailAgent(opts?: {
  message?: string;
  inboxPreview?: MailInboxPreview[];
  focus?: MailAgentFocus;
}) {
  if (typeof window === 'undefined') return;

  const base =
    opts?.message?.trim() ||
    'Help me triage my inbox — what needs a reply, what can wait, and what should I archive?';

  const chunks: string[] = [];
  if (opts?.focus) {
    chunks.push(
      [
        'Focused email:',
        opts.focus.id ? `Message id: ${opts.focus.id}` : '',
        opts.focus.account ? `Account: ${opts.focus.account}` : '',
        `From: ${opts.focus.from}`,
        `Subject: ${opts.focus.subject}`,
        opts.focus.to ? `To: ${opts.focus.to}` : '',
        opts.focus.bodyPreview
          ? `Body preview:\n${opts.focus.bodyPreview.slice(0, 3000)}`
          : '',
        opts.focus.id
          ? 'Use gmail_get_message with this message id if you need the full body beyond the preview.'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } else if (opts?.inboxPreview?.length) {
    chunks.push(
      `I have ${opts.inboxPreview.length} messages visible in Collaborate Mail (metadata is in ## Mail context on your side). Triage from gmail_list_inbox / gmail_get_message — do not claim you lack inbox access.`,
    );
  }

  chunks.push(base);

  // ensureAgentPanel: true — App opens side rail + queues send until ChatAssistant mounts (no /agent navigation).
  window.dispatchEvent(
    new CustomEvent(IAM_AGENT_CHAT_NEW_THREAD, {
      detail: {
        message: chunks.join('\n\n'),
        ensureAgentPanel: true,
        surface: 'mail',
        route_key: 'mail_triage',
        task_type: 'mail_triage',
      },
    }),
  );
}
