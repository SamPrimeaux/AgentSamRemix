/**
 * Cloudflare Workflows Client Adapter.
 * Bridges Worker binding (e.g. env.IAM_WORKFLOWS) and Cloudflare REST API.
 * Does NOT vendor generated Python SDKs or heavy dependencies.
 */

export interface CloudflareWorkflowConfig {
  accountId?: string;
  apiToken?: string;
  bindingName?: string;
  baseUrl?: string;
}

export class CloudflareWorkflowClient {
  private accountId: string;
  private apiToken: string;
  private baseUrl: string;

  constructor(config: CloudflareWorkflowConfig = {}) {
    this.accountId = config.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || "";
    this.apiToken = config.apiToken || process.env.CLOUDFLARE_API_TOKEN || "";
    this.baseUrl = config.baseUrl || "https://api.cloudflare.com/client/v4";
  }

  /**
   * Checks if native Cloudflare Workflows Worker binding is available in this execution context.
   */
  public getWorkerBinding(workflowName: string): any | null {
    const g = globalThis as any;
    if (g && g[workflowName] && typeof g[workflowName].create === "function") {
      return g[workflowName];
    }
    if (g && g.IAM_WORKFLOWS && typeof g.IAM_WORKFLOWS.create === "function") {
      return g.IAM_WORKFLOWS;
    }
    return null;
  }

  /**
   * Makes authenticated Cloudflare Workflows REST API call.
   */
  public async request<T = any>(
    path: string,
    options: {
      method?: string;
      body?: any;
      query?: Record<string, string>;
    } = {}
  ): Promise<{ result: T; success: boolean; errors?: any[] }> {
    if (!this.accountId || !this.apiToken) {
      // Local fallback / emulator mode
      return { result: {} as T, success: true };
    }

    let url = `${this.baseUrl}/accounts/${this.accountId}/workflows${path}`;
    if (options.query) {
      const q = new URLSearchParams(options.query).toString();
      url += `?${q}`;
    }

    try {
      const res = await fetch(url, {
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`[CloudflareWorkflows] API error ${res.status}: ${errText}`);
      }

      return (await res.json()) as { result: T; success: boolean; errors?: any[] };
    } catch (e) {
      throw new Error(`[CloudflareWorkflows] Network error: ${(e as Error).message}`);
    }
  }
}
