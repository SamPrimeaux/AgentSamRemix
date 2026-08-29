import { Env } from '../index';

const SYSTEM_PROMPT = `
You are an expert AI web developer. You generate complete web pages as HTML documents.
Return a full HTML document with a <head> and a <body>.
Keep the layout simple and use Tailwind CSS.
`;

export async function* streamPageGeneration(
  env: Env,
  prompt: string,
  currentPageHtml: string | null = null,
  isGrounded: boolean = false,
  formState?: Array<{ name: string; type: string; value: string }>,
  isMobile: boolean = false,
): AsyncGenerator<string> {
  
  let userPrompt = `Task: Generate a new web page.\nDescription: "${prompt}"`;
  
  if (currentPageHtml !== null) {
    userPrompt = `Update this page based on the following.\nInstruction: "${prompt}"\nCURRENT HTML:\n${currentPageHtml}`;
  }

  // Pre-flight token estimates
  const inputTokens = Math.round((userPrompt.length + SYSTEM_PROMPT.length) / 4);
  yield `__TOKEN__${JSON.stringify({ input: inputTokens, output: 0, isEstimate: true })}`;

  try {
    // We use the native Workers AI binding instead of the REST fetch or Google SDK
    const response = await env.AGENTSAM_WAI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]
    });

    const responseText = response.response || '';
    
    // Estimate output tokens
    const outputTokens = Math.round(responseText.length / 4);
    yield `__TOKEN__${JSON.stringify({ input: inputTokens, output: outputTokens, isEstimate: true })}`;
    
    // Yield the actual generated text
    yield responseText;
    
    // Yield final metadata
    yield `__META__${JSON.stringify({ 
      tokenCount: { input: inputTokens, output: outputTokens }, 
      groundingSources: [], 
      searchEntryPointHtml: '' 
    })}`;
    
  } catch (error) {
    console.error("Workers AI Error:", error);
    yield `<div class="p-8 text-red-600"><h1>Generation Error</h1><p>${error}</p></div>`;
  }
}