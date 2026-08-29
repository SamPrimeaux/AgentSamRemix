export type IamFetch = typeof fetch;

export type ApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: IamFetch;
};

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl || fetch;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
    return fetchImpl(url, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init.headers || {}),
      },
    });
  }

  async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await request(path, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`iam_http_${response.status}${detail ? `:${detail.slice(0, 240)}` : ''}`);
    }
    return response.json() as Promise<T>;
  }

  return { request, json };
}
