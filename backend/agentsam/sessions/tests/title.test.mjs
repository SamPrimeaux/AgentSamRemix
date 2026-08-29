import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveChatSessionTitle,
  isPlaceholderChatSessionTitle,
} from '../title.js';

describe('backend/agentsam/sessions/title', () => {
  it('detects placeholder titles', () => {
    assert.equal(isPlaceholderChatSessionTitle(''), true);
    assert.equal(isPlaceholderChatSessionTitle('Chat'), true);
    assert.equal(isPlaceholderChatSessionTitle('New Chat'), true);
    assert.equal(isPlaceholderChatSessionTitle('Agent chat'), true);
    assert.equal(isPlaceholderChatSessionTitle('Fix auth redirect'), false);
  });

  it('derives a short title from first user message', () => {
    const title = deriveChatSessionTitle('please fix the oauth redirect loop on login');
    assert.ok(title.length > 0 && title.length <= 40);
    assert.doesNotMatch(title, /please/i);
  });
});
