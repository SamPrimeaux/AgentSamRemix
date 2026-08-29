import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeHydratedHistory,
  normalizeUserTurnContent,
} from './agent-controller-history.js';

describe('mergeHydratedHistory', () => {
  it('dedups by turn_nonce', () => {
    const prior = [
      { role: 'user', content: 'hi', metadata: { turn_nonce: 'n1' } },
      { role: 'assistant', content: 'yo' },
    ];
    const out = mergeHydratedHistory(prior, 'hi again', 'n1');
    assert.equal(out.deduped, true);
    assert.equal(out.dedupReason, 'turn_nonce');
    assert.equal(out.chatMessages.length, 2);
  });

  it('dedups identical tip user content without hashing', () => {
    const prior = [
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: '  hello world  ' },
    ];
    const out = mergeHydratedHistory(prior, 'hello world');
    assert.equal(out.deduped, true);
    assert.equal(out.dedupReason, 'content_match');
    assert.equal(out.chatMessages.length, 2);
  });

  it('appends when same text appears earlier but tip is not that user turn', () => {
    const prior = [
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'hi' },
    ];
    const out = mergeHydratedHistory(prior, 'hello world');
    assert.equal(out.deduped, false);
    assert.equal(out.chatMessages.length, 3);
  });

  it('appends when content differs', () => {
    const prior = [{ role: 'user', content: 'a' }];
    const out = mergeHydratedHistory(prior, 'b');
    assert.equal(out.deduped, false);
    assert.equal(out.chatMessages.length, 2);
    assert.equal(out.chatMessages[1].content, 'b');
  });

  it('normalizes array text parts for equality', () => {
    assert.equal(
      normalizeUserTurnContent([{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }]),
      'x\ny',
    );
    const prior = [{ role: 'user', content: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] }];
    const out = mergeHydratedHistory(prior, 'x\ny');
    assert.equal(out.deduped, true);
    assert.equal(out.dedupReason, 'content_match');
  });

  it('strips pending assistant stubs then dedups the current user turn', () => {
    const prior = [
      { role: 'assistant', content: "Hi! I'm Agent Sam. What should we work on?" },
      { role: 'user', content: 'what can you do' },
      { role: 'assistant', content: '', status: 'pending' },
    ];
    const out = mergeHydratedHistory(prior, 'what can you do');
    assert.equal(out.deduped, true);
    assert.equal(out.dedupReason, 'content_match');
    assert.equal(out.chatMessages.length, 1);
    assert.equal(out.chatMessages[0].role, 'user');
  });
});
