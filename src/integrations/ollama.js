const OLLAMA_BASE = 'https://ollama.inneranimalmedia.com';

async function ollamaFetch(path, body, method = 'POST') {
  const res = await fetch(`${OLLAMA_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function ollamaTags() {
  return ollamaFetch('/api/tags', null, 'GET');
}

export async function ollamaGenerate(model, prompt, options = {}) {
  return ollamaFetch('/api/generate', { model, prompt, stream: false, ...options });
}

export async function ollamaChat(model, messages, options = {}) {
  return ollamaFetch('/api/chat', { model, messages, stream: false, ...options });
}
