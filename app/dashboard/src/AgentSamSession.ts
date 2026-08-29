import type { DurableObjectState } from '@cloudflare/workers-types';

export class AgentSamSession {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/get') {
      const data = await this.state.storage.list();
      return new Response(JSON.stringify(Object.fromEntries(data)), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (path === '/set' && request.method === 'POST') {
      const body = await request.json() as Record<string, unknown>;
      await this.state.storage.put(body);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (path === '/canvas' && request.method === 'POST') {
      const body = await request.json() as { elements: unknown[] };
      if (body && Array.isArray(body.elements)) {
         await this.state.storage.put('canvasElements', JSON.stringify(body.elements));
      }
      return new Response(JSON.stringify({ ok: true }));
    }
    
    if (path === '/theme' && request.method === 'POST') {
      const body = await request.json() as { slug: string };
      if (body && typeof body.slug === 'string') {
         await this.state.storage.put('activeTheme', body.slug);
      }
      return new Response(JSON.stringify({ ok: true }));
    }
    
    return new Response('Not found', { status: 404 });
  }
}
