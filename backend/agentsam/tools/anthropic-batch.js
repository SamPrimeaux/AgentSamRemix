/**
 * Tool: Anthropic Batch Manager
 * Orchestrates high-volume background processing using the Message Batches API.
 * Leverages the SDK for stateful monitoring and result retrieval.
 */

import { createAnthropicBatch } from '../../../src/integrations/anthropic.js';
import Anthropic from '@anthropic-ai/sdk';

export const handlers = {
    /**
     * Spawns a new Message Batch.
     * requests: Array of { custom_id, params: { model, messages, max_tokens } }
     */
    anthropic_batch_create: async ({ requests }, env) => {
        if (!requests || !Array.isArray(requests)) throw new Error('Requests array required');
        
        console.log(`[Batch API] Initializing batch with ${requests.length} requests...`);
        return await createAnthropicBatch({ requests, env });
    },

    /**
     * Retrieves the status or results of a batch metadata.
     */
    anthropic_batch_retrieve: async ({ batch_id }, env) => {
        if (!batch_id) throw new Error('batch_id required');
        
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const batch = await client.messages.batches.retrieve(batch_id);
        
        // If finished, notify the agent that results are ready for retrieval
        if (batch.processing_status === 'ended') {
            return {
                ...batch,
                _instructions: 'Batch complete. Use anthropic_batch_get_results to retrieve final message content.'
            };
        }
        
        return batch;
    },

    /**
     * Streams the results of a completed batch.
     */
    anthropic_batch_get_results: async ({ batch_id }, env) => {
        if (!batch_id) throw new Error('batch_id required');
        
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const results = [];
        for await (const entry of client.messages.batches.results(batch_id)) {
            results.push(entry);
        }
        return results;
    },

    /**
     * Lists recent batches for the organization.
     */
    anthropic_batch_list: async ({ limit = 10 }, env) => {
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const list = [];
        for await (const batch of client.messages.batches.list({ limit })) {
            list.push(batch);
        }
        return list;
    }
};
