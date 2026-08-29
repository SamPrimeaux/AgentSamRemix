import { assertCmsAiProvider } from './contracts.js';
import { buildCmsAiProposalPrompt } from './prompt.js';

function parseJson(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').replace(/```json|```/gi, '').trim();
  if (!text) throw new Error('cms_ai_empty_response');
  return JSON.parse(text);
}

export function createCmsAiService(providerInput) {
  const provider = assertCmsAiProvider(providerInput);
  return Object.freeze({
    async propose(task) {
      const prompt = buildCmsAiProposalPrompt(task);
      const response = await provider.complete({
        purpose: 'cms_plan',
        requested_model_key: task.requested_model_key,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        response_format: 'json',
      });
      const payload = response?.json ?? response?.output ?? response?.text ?? response?.output_text ?? response;
      return parseJson(payload);
    },
  });
}
