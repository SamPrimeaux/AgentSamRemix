/**
 * Server-side Gemini proxy. Calls the Gemini REST API directly (no SDK
 * dependency -- guaranteed to run in the Workers isolate as-is) using
 * whatever key aiKeyStore.resolveAiKey() resolves for the current user.
 * The API key is fetched here, used here, and never sent to the client.
 *
 * Re-emits the exact same streaming text protocol the original client-side
 * geminiService.ts used to produce (__TOKEN__{json}, raw text chunks,
 * __META__{json}), so the frontend's public streamPageGeneration() contract
 * is unchanged for anything that already consumes it.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const SYSTEM_PROMPT = `
You are powered by Gemini, generating complete web pages as HTML documents.

STRUCTURE:
Return a full HTML document with a <head> and a <body>:

<html>
<head>
  <title>SiteName - Page Name</title>
  <meta name="color-scheme" content="light">
  <link href="https://fonts.googleapis.com/css2?family=ChosenFont:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="font-family: 'Chosen Font', sans-serif">
  ...page content...
</body>
</html>

Keep the <head> minimal -- just the <title>, <meta name="color-scheme">, and a Google Fonts <link>. Tailwind CSS and scripts are injected automatically.
The <title> format is: "SiteName - PageName" eg. "UKNews - Home".
Set color-scheme to "light" or "dark" -- choose whichever suits the site. Use only one.

STYLING:
Use Tailwind CSS utility classes for all styling. Create rich, polished, realistic-looking pages.
Use Google Fonts for the site. Include the <link> tag in <head> and apply the font via an inline style on the <body> tag (e.g., style="font-family: 'Playfair Display', serif"). Each site should feel typographically distinct.
For icons, use Material Symbols: <span class="material-symbols-outlined">icon_name</span> (e.g., home, search, settings, favorite, delete, mail, star).
Use emojis generously for visual flair and as image placeholders.
For images, use CSS gradients, inline SVGs, or emoji placeholders.

NAVIGATION:
Use <a href="..."> tags with descriptive path-like hrefs (e.g., href="inbox/message-from-alice", href="settings/notifications").
Every link should have a meaningful href.

INTERACTIVITY:
For actions that change the current page state (e.g., archiving, submitting, toggling), call:
  window.FlashLiteAPI.performAction('Description of intent', 'Optional payload')
Examples:
  <button onclick="FlashLiteAPI.performAction('Archive email 42')">Archive</button>
  <form onsubmit="event.preventDefault(); FlashLiteAPI.performAction('Search', this.q.value)">

CONTENT:
Fill every page with rich, plausible, detailed content. Make it feel like a real website.
`;

export interface GeminiPageRequest {
  prompt: string;
  currentPageHtml?: string | null;
  isGrounded?: boolean;
  formState?: Array<{ name: string; type: string; value: string }>;
  isMobile?: boolean;
  model?: string;
}

function buildUserPrompt(req: GeminiPageRequest): string {
  const isEdit = req.currentPageHtml != null;
  let userPrompt: string;

  if (isEdit) {
    const formStateBlock = req.formState?.length
      ? `\n\nThe user entered the following values into input fields on the previous page:\n${req.formState.map((f) => `- ${f.name || 'unnamed'} (${f.type}): "${f.value}"`).join('\n')}\n`
      : '';
    userPrompt = `\nUpdate this page based on the following.\nInstruction: "${req.prompt}"\n\nKeep the layout and style generally consistent.\nReturn the complete updated HTML document.${formStateBlock}\n\nCURRENT HTML:\n${req.currentPageHtml}\n`;
  } else {
    userPrompt = `\nTask: Generate a new web page.\nDescription: "${req.prompt}"\n\nCreate a complete, detailed, realistic-looking web page based on this description.\n`;
  }

  if (req.isGrounded) {
    userPrompt += `\nIMPORTANT: You have access to Google Search. Use it to find current, accurate data for populating the page content. Always ground the page in search results -- use real names, real statistics, real facts from your Google searches.\n`;
  }
  if (req.isMobile) {
    userPrompt += `\nIMPORTANT: The user is on a MOBILE device with a narrow viewport. Design mobile-first:\n- Use a single-column layout\n- Use responsive Tailwind classes)\n- Avoid horizontal scrolling\n- Stack elements vertically\n- Keep navigation simple\n`;
  }

  return userPrompt;
}

async function countTokens(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<number> {
  try {
    const res = await fetch(`${API_BASE}/models/${model}:countTokens?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'user', parts: [{ text: userPrompt }] },
        ],
      }),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { totalTokens?: number };
    return data.totalTokens || 0;
  } catch (e) {
    console.warn('[geminiProxy] countTokens failed:', e);
    return 0;
  }
}

/**
 * Streams the exact same textual protocol streamPageGeneration() used to
 * yield, as a Response the Worker route can return directly.
 */
export async function streamGeminiPage(apiKey: string, req: GeminiPageRequest, abortSignal?: AbortSignal): Promise<Response> {
  const model = req.model || 'gemini-2.5-flash';
  const userPrompt = buildUserPrompt(req);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (s: string) => controller.enqueue(encoder.encode(s));

      try {
        let inputTokens = await countTokens(apiKey, model, SYSTEM_PROMPT, userPrompt);
        enqueue(`__TOKEN__${JSON.stringify({ input: inputTokens, output: 0, isEstimate: true })}`);

        const body: any = {
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        };
        if (req.isGrounded) {
          body.tools = [{ googleSearch: {} }];
        }

        const upstream = await fetch(`${API_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortSignal,
        });

        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text().catch(() => 'unknown error');
          enqueue(`<div class="p-8 text-red-600"><h1>Generation Error</h1><p>HTTP ${upstream.status}: ${errText}</p></div>`);
          controller.close();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let outputTokens = 0;
        let totalChars = 0;
        let groundingSources: Array<{ title: string; uri: string }> = [];
        let searchEntryPointHtml = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by blank lines; each frame's payload is on a "data: " line.
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';

          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            let chunk: any;
            try {
              chunk = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            if (chunk.usageMetadata) {
              if (chunk.usageMetadata.promptTokenCount) inputTokens = chunk.usageMetadata.promptTokenCount;
              outputTokens = chunk.usageMetadata.candidatesTokenCount || 0;
            }

            const groundingMeta = chunk.candidates?.[0]?.groundingMetadata;
            if (groundingMeta?.groundingChunks?.length) {
              groundingSources = groundingMeta.groundingChunks
                .filter((c: any) => c.web?.uri && c.web?.title)
                .map((c: any) => ({ title: c.web.title, uri: c.web.uri }));
            }
            if (groundingMeta?.searchEntryPoint?.renderedContent) {
              searchEntryPointHtml = groundingMeta.searchEntryPoint.renderedContent;
            }

            const text = chunk.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
            if (text) {
              totalChars += text.length;
              const estimatedOutput = Math.round(totalChars / 4);
              enqueue(`__TOKEN__${JSON.stringify({ input: inputTokens, output: estimatedOutput, isEstimate: true })}`);
              enqueue(text);
            }
          }
        }

        enqueue(`__META__${JSON.stringify({ tokenCount: { input: inputTokens, output: outputTokens }, groundingSources, searchEntryPointHtml })}`);
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          console.error('[geminiProxy] stream error:', error);
          enqueue(`<div class="p-8 text-red-600"><h1>Generation Error</h1><p>${String(error)}</p></div>`);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
