import { getAccessToken } from './googleAuth';

export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId?: string;
  internalDate: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  cc?: string;
  bodyHtml?: string;
  bodyPlain?: string;
  attachments?: GmailAttachment[];
  isStarred?: boolean;
  isUnread?: boolean;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageListVisibility?: string;
  labelListVisibility?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: {
    textColor: string;
    backgroundColor: string;
  };
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

/**
 * Base64 URL safe encoder
 */
function toBase64Url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Base64 URL safe decoder
 */
function fromBase64Url(base64Url: string): string {
  try {
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return decodeURIComponent(escape(atob(base64)));
  } catch (e) {
    try {
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      return atob(base64);
    } catch {
      return '';
    }
  }
}

/**
 * Extract body content from Gmail message payload parts recursively
 */
function extractBody(payload: any): { html?: string; plain?: string; attachments: GmailAttachment[] } {
  let html = '';
  let plain = '';
  const attachments: GmailAttachment[] = [];

  function traverse(part: any) {
    if (!part) return;

    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size || 0,
      });
    }

    if (part.mimeType === 'text/html' && part.body?.data) {
      html += fromBase64Url(part.body.data);
    } else if (part.mimeType === 'text/plain' && part.body?.data) {
      plain += fromBase64Url(part.body.data);
    }

    if (part.parts && Array.isArray(part.parts)) {
      part.parts.forEach(traverse);
    }
  }

  traverse(payload);

  if (!html && !plain && payload?.body?.data) {
    const raw = fromBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') {
      html = raw;
    } else {
      plain = raw;
    }
  }

  return { html: html || undefined, plain: plain || undefined, attachments };
}

/**
 * Parse headers into convenient key-value pairs
 */
function parseHeaders(headers: GmailMessageHeader[] = []): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    map[h.name.toLowerCase()] = h.value;
  }
  return map;
}

/**
 * Fetch Gmail user profile
 */
export async function getGmailProfile(): Promise<GmailProfile> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to fetch profile (HTTP ${res.status})`);
  }

  return await res.json();
}

/**
 * Fetch all Gmail labels
 */
export async function listGmailLabels(): Promise<GmailLabel[]> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to fetch labels (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.labels || [];
}

/**
 * List messages matching query, label, or pagination
 */
export async function listGmailMessages(options: {
  maxResults?: number;
  q?: string;
  labelIds?: string[];
  pageToken?: string;
} = {}): Promise<{ messages: { id: string; threadId: string }[]; nextPageToken?: string; resultSizeEstimate?: number }> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google');

  const params = new URLSearchParams();
  params.set('maxResults', String(options.maxResults || 25));
  if (options.q) params.set('q', options.q);
  if (options.pageToken) params.set('pageToken', options.pageToken);
  if (options.labelIds && options.labelIds.length > 0) {
    options.labelIds.forEach(l => params.append('labelIds', l));
  }

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to list messages (HTTP ${res.status})`);
  }

  const data = await res.json();
  return {
    messages: data.messages || [],
    nextPageToken: data.nextPageToken,
    resultSizeEstimate: data.resultSizeEstimate,
  };
}

/**
 * Fetch detailed single message
 */
export async function getGmailMessage(id: string): Promise<GmailMessage> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google');

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to get message ${id}`);
  }

  const data = await res.json();
  const headers = parseHeaders(data.payload?.headers);
  const { html, plain, attachments } = extractBody(data.payload);

  const labelIds: string[] = data.labelIds || [];

  return {
    id: data.id,
    threadId: data.threadId,
    labelIds,
    snippet: data.snippet || '',
    historyId: data.historyId,
    internalDate: data.internalDate,
    subject: headers['subject'] || '(No Subject)',
    from: headers['from'] || 'Unknown Sender',
    to: headers['to'] || '',
    date: headers['date'] || '',
    cc: headers['cc'],
    bodyHtml: html,
    bodyPlain: plain,
    attachments,
    isStarred: labelIds.includes('STARRED'),
    isUnread: labelIds.includes('UNREAD'),
  };
}

/**
 * Send an email message (Requires user confirmation dialog before invoking)
 */
export async function sendGmailMessage(params: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
  inReplyTo?: string;
  isHtml?: boolean;
}): Promise<GmailMessage> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google');

  // Build standard RFC 2822 MIME message
  const lines: string[] = [
    `To: ${params.to}`,
    `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(params.subject)))}?=`,
    `Content-Type: ${params.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
    `MIME-Version: 1.0`,
  ];

  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  if (params.inReplyTo) {
    lines.push(`In-Reply-To: ${params.inReplyTo}`);
    lines.push(`References: ${params.inReplyTo}`);
  }

  lines.push(''); // Blank line between headers and body
  lines.push(params.body);

  const rawMessage = lines.join('\r\n');
  const encodedMessage = toBase64Url(rawMessage);

  const bodyPayload: any = { raw: encodedMessage };
  if (params.threadId) {
    bodyPayload.threadId = params.threadId;
  }

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to send email (HTTP ${res.status})`);
  }

  return await res.json();
}

/**
 * Create a draft email
 */
export async function createGmailDraft(params: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  threadId?: string;
  isHtml?: boolean;
}): Promise<any> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google');

  const lines: string[] = [
    `To: ${params.to}`,
    `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(params.subject)))}?=`,
    `Content-Type: ${params.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
    `MIME-Version: 1.0`,
  ];

  if (params.cc) lines.push(`Cc: ${params.cc}`);
  lines.push('');
  lines.push(params.body);

  const rawMessage = lines.join('\r\n');
  const encodedMessage = toBase64Url(rawMessage);

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        raw: encodedMessage,
        threadId: params.threadId,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to create draft`);
  }

  return await res.json();
}

/**
 * Modify message labels (Star, Mark Read, Move to Trash, Archive)
 */
export async function modifyGmailMessage(
  id: string,
  options: { addLabelIds?: string[]; removeLabelIds?: string[] }
): Promise<GmailMessage> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google');

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to modify message ${id}`);
  }

  return await res.json();
}

/**
 * Move message to Trash (Requires confirmation)
 */
export async function trashGmailMessage(id: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google');

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to move message ${id} to trash`);
  }
}

/**
 * Permanently delete message from Gmail (Requires confirmation)
 */
export async function deleteGmailMessage(id: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google');

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to delete message ${id}`);
  }
}
