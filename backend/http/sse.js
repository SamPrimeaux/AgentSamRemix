/**
 * Generic SSE transport — TextEncoder / TransformStream / headers only.
 * No AgentSam, MCP, workflow, or browser behavior.
 */

/**
 * @returns {{
 *   response: Response,
 *   emit: (data: Record<string, unknown>) => void,
 *   close: () => Promise<void>,
 * }}
 */
export function createSseStream() {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  let closed = false;

  const emit = (data) => {
    if (closed) return;
    try {
      writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      /* stream already closed */
    }
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await writer.close();
    } catch {
      /* noop */
    }
  };

  const response = new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });

  return { response, emit, close };
}
