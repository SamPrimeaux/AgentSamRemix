import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseThreadSlashCommand,
  loadConversationMessages,
  runThreadActionOnDemand,
} from '../thread-on-demand.js';

describe('backend/agentsam/sessions/thread-on-demand', () => {
  it('parses exact /compact and /summarize only', () => {
    assert.equal(parseThreadSlashCommand('/compact'), 'compact');
    assert.equal(parseThreadSlashCommand('  /SUMMARIZE  '), 'summarize');
    assert.equal(parseThreadSlashCommand('/compact please'), null);
    assert.equal(parseThreadSlashCommand('compact'), null);
    assert.equal(parseThreadSlashCommand(''), null);
  });

  it('uses client fallback when durable history is empty', async () => {
    const messages = await loadConversationMessages(
      {},
      'conv_missing',
      [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }],
    );
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].content, 'hi');
  });

  it('refuses thread actions without identity + conversation', async () => {
    const out = await runThreadActionOnDemand({}, {}, {
      action: 'compact',
      userId: '',
      workspaceId: 'ws_x',
      conversationId: 'conv_x',
    });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'missing_identity_or_conversation');
  });
});
