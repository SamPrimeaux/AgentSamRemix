/**
 * Client for the server-side Gemini proxy (app/backend/src/lib/geminiProxy.ts).
 * No API key here at all -- it lives only in the Worker, resolved per-request
 * from aiKeyStore.ts (user override in D1, else env.GEMINI_API_KEY). Same
 * public streamPageGeneration() signature and yield contract as the prior
 * client-side implementation, so nothing downstream needs to change.
 */
// TokenCount defined locally -- app/frontend/types is a directory (agentSam.ts,
// bindings.ts), not a barrel file, and never exported this type on main.
export interface TokenCount {
  input: number;
  output: number;
  isEstimate?: boolean;
}

export interface GenerationResult {
  tokenCount: TokenCount;
}

/**
 * Unified page generation — handles both create and edit.
 * - If currentPageHtml is provided → edit mode (update based on prompt)
 * - If currentPageHtml is null → create mode (generate from scratch)
 *
 * Yields HTML chunks as they stream in.
 * After the stream completes, the final yield is a GenerationResult object (as JSON string prefixed with __META__).
 */
export async function* streamPageGeneration(
  prompt: string,
  currentPageHtml: string | null = null,
  isGrounded: boolean = false,
  abortSignal?: AbortSignal,
  formState?: Array<{ name: string; type: string; value: string }>,
  isMobile: boolean = false,
): AsyncGenerator<string> {
  let response: Response;
  try {
    response = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, currentPageHtml, isGrounded, formState, isMobile }),
      signal: abortSignal,
    });
  } catch (error) {
    yield `<div class="p-8 text-red-600"><h1>Generation Error</h1><p>${error}</p></div>`;
    return;
  }

  if (!response.ok || !response.body) {
    let detail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson?.error) detail = errJson.error;
    } catch {
      // response wasn't JSON -- keep the status-only message
    }
    yield `<div class="p-8 text-red-600"><h1>Generation Error</h1><p>${detail}</p></div>`;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // The Worker already emits the exact __TOKEN__/__META__/raw-text protocol --
      // just forward decoded text through unchanged.
      yield decoder.decode(value, { stream: true });
    }
  } catch (error: any) {
    if (error?.name !== 'AbortError') {
      yield `<div class="p-8 text-red-600"><h1>Generation Error</h1><p>${error}</p></div>`;
    }
  }
}
