import { GoogleGenAI } from "@google/genai";
import { TokenCount } from '../types';

export type AIProvider = 'gemini' | 'workers-ai';

interface ProviderStats {
  successes: number;
  failures: number;
  totalLatencyMs: number;
}

// Simple Thompson Sampling state
const providerStats: Record<AIProvider, ProviderStats> = {
  'gemini': { successes: 1, failures: 0, totalLatencyMs: 1000 },
  'workers-ai': { successes: 1, failures: 0, totalLatencyMs: 1000 }
};

// Cloudflare REST API fallback if native binding is unavailable
async function callWorkersAIREST(model: string, prompt: string, systemPrompt?: string): Promise<string> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  
  if (!accountId || !apiToken) {
    throw new Error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messages })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Workers AI Error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.result.response;
}

// Sample from Beta distribution for Thompson Routing
function sampleBeta(alpha: number, beta: number): number {
  let x = 0, y = 0;
  for (let i = 0; i < alpha; i++) x += Math.random();
  for (let i = 0; i < beta; i++) y += Math.random();
  return x / (x + y);
}

export function selectProvider(override?: AIProvider): AIProvider {
  if (override) return override;
  
  // Thompson Sampling based on success rates
  const scoreGemini = sampleBeta(providerStats['gemini'].successes + 1, providerStats['gemini'].failures + 1);
  const scoreWorkersAI = sampleBeta(providerStats['workers-ai'].successes + 1, providerStats['workers-ai'].failures + 1);
  
  return scoreWorkersAI > scoreGemini ? 'workers-ai' : 'gemini';
}

export function recordProviderResult(provider: AIProvider, success: boolean, latencyMs: number) {
  const stats = providerStats[provider];
  if (success) {
    stats.successes++;
  } else {
    stats.failures++;
  }
  stats.totalLatencyMs += latencyMs;
}

export async function callAGENTSAM_WAI(prompt: string, systemPrompt?: string): Promise<{ text: string, tokenCount: TokenCount }> {
  // Use a fast text generation model from Workers AI
  const model = '@cf/meta/llama-3.1-8b-instruct';
  
  // In a real Worker, you'd use env.AI.run(). Here we use the REST API since it's a Node app.
  const responseText = await callWorkersAIREST(model, prompt, systemPrompt);
  
  // Rough token estimate (Workers AI REST API doesn't always return exact usage for all models)
  const estimatedTokens = Math.round(responseText.length / 4);
  const inputTokens = Math.round((prompt.length + (systemPrompt?.length || 0)) / 4);
  
  return {
    text: responseText,
    tokenCount: { input: inputTokens, output: estimatedTokens }
  };
}
