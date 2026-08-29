import assert from 'node:assert/strict';
import { createCmsAiService } from './index.js';
import { normalizeCmsAgentTask } from '../agents/index.js';

let request = null;
const ai = createCmsAiService({
  async complete(input) {
    request = input;
    return { text: '```json\n{"summary":"ok","operations":[{"capability":"page.read","target":{"page_id":"p1"}}]}\n```' };
  },
});
const task = normalizeCmsAgentTask({ goal: 'Inspect page', page_id: 'p1', requested_model_key: 'catalog-model' });
const result = await ai.propose(task);
assert.equal(result.operations[0].capability, 'page.read');
assert.equal(request.requested_model_key, 'catalog-model');
assert.match(request.system, /Page → Section → Block/);
assert.match(request.system, /Allowed capabilities:/);
assert.doesNotMatch(request.system, /OpenAI|Anthropic|Gemini|Claude|GPT/i);
assert.equal(request.response_format, 'json');

assert.throws(() => createCmsAiService({}), /cms_ai_provider_complete_required/);
console.log('cms-ai tests: OK');
