/**
 * Tool: Context (RAG / Knowledge / Memory / Optimization)
 * Implements 11 tools for semantic awareness and token management.
 */

async function invokeContextOp(env, endpoint, method = 'POST', body = null) {
    const origin = env.IAM_ORIGIN || 'https://inneranimalmedia.com';
    try {
        const res = await fetch(`${origin}${endpoint}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : null,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Context Operation Failed');
        return data;
    } catch (e) {
        return { error: `Context Error: ${e.message}` };
    }
}

export const handlers = {
    // ── Knowledge & RAG ──────────────────────────────────────────────────
    async knowledge_search(params, env) { return await invokeContextOp(env, '/api/context/knowledge-search', 'POST', params); },
    async rag_search(params, env) { return await invokeContextOp(env, '/api/context/rag-search', 'POST', params); },

    // ── Agent Memory (Human Context) ─────────────────────────────────────
    async human_context_add(params, env) { return await invokeContextOp(env, '/api/context/memory/add', 'POST', params); },
    async human_context_list(params, env) { return await invokeContextOp(env, '/api/context/memory/list', 'POST', params); },

    // ── Strategy & Optimization ──────────────────────────────────────────
    async context_optimize(params, env) { return await invokeContextOp(env, '/api/context/optimize', 'POST', params); },
    async context_progressive_disclosure(params, env) { return await invokeContextOp(env, '/api/context/progressive', 'POST', params); },
    async context_chunk(params, env) { return await invokeContextOp(env, '/api/context/chunk', 'POST', params); },

    // ── Extraction & Summarization ───────────────────────────────────────
    async context_extract_structure(params, env) { return await invokeContextOp(env, '/api/context/extract', 'POST', params); },
    async context_summarize_code(params, env) { return await invokeContextOp(env, '/api/context/summarize-code', 'POST', params); },
    async attached_file_content(params, env) { return await invokeContextOp(env, '/api/context/attached-content', 'POST', params); },
    async context_search(params, env) { return await invokeContextOp(env, '/api/context/progressive-search', 'POST', params); },
};
