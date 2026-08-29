export interface Env {
  AGENTSAM_WAI: Ai;
  DB: D1Database;
  WEBSITE_ASSETS: R2Bucket;
  ASSETS: R2Bucket;
  APP_ASSETS: Fetcher;
  IAM_VPC: Fetcher;
  AgentSam: DurableObjectNamespace;
  BROWSER: any;
  LOADER: WorkerLoader;
  AGENTSAM_BRIDGE_KEY?: string;
  AGENTSAM_MODEL?: string;

  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  IAM_CLIENT_ID?: string;
  IAM_CLIENT_SECRET?: string;
  IAM_OAUTH_ISSUER?: string;

  SECRETS_ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
}
