export interface Env {
  AGENTSAM_WAI: Ai;
  DB: D1Database;
  HYPERDRIVE: Hyperdrive;
  WEBSITE_ASSETS: R2Bucket;
  ASSETS: R2Bucket;
  APP_ASSETS: Fetcher;

  AgentSam: DurableObjectNamespace;
  MY_CONTAINER: DurableObjectNamespace<any>;
  MYBROWSER: any;
  LOADER: WorkerLoader;

  EXECOS: Fetcher;
  PTY_SERVICE: Fetcher;
  SESSION_CACHE: KVNamespace;

  AGENTSAM_BRIDGE_KEY?: string;
  AGENTSAM_MODEL?: string;

  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  IAM_CLIENT_ID?: string;
  IAM_CLIENT_SECRET?: string;
  IAM_OAUTH_ISSUER?: string;

  VAULT_MASTER_KEY?: string;
  VAULT_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  CLOUDFLARE_API_TOKEN?: string;
  RESEND_API_KEY?: string;
  SUPABASE_URL?: string;

  GOOGLE_AI_PROJECT_NUMBER?: string;
  GOOGLE_AI_PROJECT_NAME?: string;
  GOOGLE_AI_PROJECT_DISPLAY_NAME?: string;
}
