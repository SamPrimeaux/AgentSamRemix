export interface TelemetryData {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  cost: number;
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Pricing per 1M tokens
  const prices: Record<string, { input: number, output: number }> = {
    'gemini-3.7-flash': { input: 0.38, output: 1.88 },
    'gemini-3.5-flash': { input: 1.50, output: 9.00 },
    'gemini-3.1-flash-lite': { input: 0.15, output: 1.25 },
    'antigravity': { input: 2.00, output: 12.00 }, // Placeholder pricing
    'codex': { input: 2.00, output: 12.00 }, // Placeholder pricing
  };

  const modelPrice = prices[model] || { input: 0.1, output: 0.4 };
  return (inputTokens / 1_000_000) * modelPrice.input + (outputTokens / 1_000_000) * modelPrice.output;
}

export function logTelemetry(data: TelemetryData) {
  console.log("Telemetry:", JSON.stringify(data));
  // In a real production system, you'd send this to a backend/analytics service
}
