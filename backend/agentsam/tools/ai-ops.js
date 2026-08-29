/**
 * ai_complete / ai_compare / ai_embed — Workers AI + shared embeddings.
 */
import { generateWorkersAiEmbedding } from '../../../src/core/embed-workers-ai.js';

const WAI_COMPACT = '@cf/meta/llama-3.1-8b-instruct';

async function runWorkersAiText(env, system, user) {
  if (!env?.AI) return { error: 'Workers AI binding (env.AI) not configured' };
  const messages = [
    ...(system ? [{ role: 'system', content: String(system).slice(0, 8000) }] : []),
    { role: 'user', content: String(user).slice(0, 12000) },
  ];
  const res = await env.AI.run(WAI_COMPACT, { messages });
  const text =
    (typeof res === 'string' && res) ||
    res?.response ||
    res?.result ||
    (Array.isArray(res?.messages) && res.messages[0]?.content) ||
    '';
  if (!text) return { error: 'empty_completion', raw: res };
  return { success: true, text: String(text).trim() };
}

export const handlers = {
  async ai_embed(params, env) {
    const text = params.text != null ? String(params.text) : params.input != null ? String(params.input) : '';
    if (!text.trim()) return { error: 'text required' };
    try {
      const vec = await generateWorkersAiEmbedding(env, text.slice(0, 8000));
      return { success: true, dimensions: Array.isArray(vec) ? vec.length : vec?.length ?? 0, embedding: vec };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },

  async ai_complete(params, env) {
    const prompt = params.prompt != null ? String(params.prompt) : String(params.text || '');
    const system = params.system != null ? String(params.system) : '';
    if (!prompt.trim()) return { error: 'prompt required' };
    return await runWorkersAiText(env, system || null, prompt);
  },

  async ai_compare(params, env) {
    const a = params.a != null ? String(params.a) : '';
    const b = params.b != null ? String(params.b) : '';
    if (!a.trim() || !b.trim()) return { error: 'a and b required' };
    const rubric = params.rubric != null ? String(params.rubric) : 'similarity, factual overlap, and contradictions';
    const sys = `Compare two texts. ${rubric}. Respond with concise bullet points.`;
    const user = `TEXT_A:\n${a.slice(0, 6000)}\n\nTEXT_B:\n${b.slice(0, 6000)}`;
    const w = await runWorkersAiText(env, sys, user);
    if (w.error) {
      if (!env?.DB) return w;
      try {
        const { dispatchComplete } = await import('../runtime/provider-dispatch.js');
        const { resolveModelForTask } = await import('../../../src/core/resolveModel.js');
        const workspaceId =
          params.workspace_id != null && String(params.workspace_id).trim() !== ''
            ? String(params.workspace_id).trim()
            : params.workspaceId != null && String(params.workspaceId).trim() !== ''
              ? String(params.workspaceId).trim()
              : null;
        const resolved = await resolveModelForTask(env, {
          task_type: 'quick',
          mode: 'ask',
          workspace_id: workspaceId,
          require_tools: false,
        });
        if (!resolved?.model_key) {
          throw new Error('ai-ops: resolveModelForTask returned no model');
        }
        const modelKey = resolved.model_key;
        const data = await dispatchComplete(env, {
          modelKey,
          systemPrompt: sys,
          messages: [{ role: 'user', content: user }],
          tools: [],
          userId: params.user_id || null,
          options: { reasoningEffort: 'none', verbosity: 'low' },
        });
        const text =
          (typeof data?.text === 'string' && data.text) ||
          data?.choices?.[0]?.message?.content ||
          data?.output_text ||
          '';
        if (!String(text).trim()) return { error: 'empty_completion', via: 'openai_catalog' };
        return { success: true, text: String(text).trim(), via: 'openai_catalog' };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return { ...w, via: 'workers_ai' };
  },
};
