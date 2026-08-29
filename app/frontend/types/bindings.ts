export type BindingFamily =
  | 'd1'
  | 'kv'
  | 'r2'
  | 'durable_object'
  | 'ai'
  | 'browser'
  | 'vectorize'
  | 'queue'
  | 'workflow'
  | 'service'
  | 'analytics_engine'
  | 'vars'
  | 'secrets';

export type BindingEnvironment = 'all' | 'development' | 'preview' | 'production';

export type BindingStatus = 'configured' | 'bound' | 'mocked' | 'unbound' | 'active';

export interface BaseBinding {
  id: string;
  family: BindingFamily;
  binding: string;
  enabled: boolean;
  environment: BindingEnvironment;
  description: string;
  status: BindingStatus;
  isSecret?: boolean;
}

export interface D1Binding extends BaseBinding {
  family: 'd1';
  database_name: string;
  database_id: string;
  migrations_dir?: string;
  preview_database_id?: string;
}

export interface KVBinding extends BaseBinding {
  family: 'kv';
  namespace_id: string;
  preview_id?: string;
}

export interface R2Binding extends BaseBinding {
  family: 'r2';
  bucket_name: string;
  preview_bucket_name?: string;
  jurisdiction?: 'default' | 'eu' | 'fedramp';
}

export interface DurableObjectBinding extends BaseBinding {
  family: 'durable_object';
  class_name: string;
  script_name?: string;
  target_environment?: string;
}

export interface WorkersAIBinding extends BaseBinding {
  family: 'ai';
  gateway_id?: string;
  model_routing?: 'auto' | 'primary_only' | 'fallback_ladder';
}

export interface BrowserBinding extends BaseBinding {
  family: 'browser';
  engine: 'kitesurf_worker' | 'browser_run_cdp';
  session_timeout_sec?: number;
}

export interface VectorizeBinding extends BaseBinding {
  family: 'vectorize';
  index_name: string;
  dimensions: number;
  metric: 'cosine' | 'euclidean' | 'dot-product';
}

export interface QueueBinding extends BaseBinding {
  family: 'queue';
  queue_name: string;
  max_batch_size?: number;
  max_batch_timeout?: number;
  role?: 'producer' | 'consumer';
}

export interface WorkflowBinding extends BaseBinding {
  family: 'workflow';
  name: string;
  class_name: string;
  script_name?: string;
}

export interface ServiceBinding extends BaseBinding {
  family: 'service';
  service: string;
  service_environment?: string;
  entrypoint?: string;
}

export interface AnalyticsEngineBinding extends BaseBinding {
  family: 'analytics_engine';
  dataset: string;
}

export interface EnvVarBinding extends BaseBinding {
  family: 'vars';
  name: string;
  value: string;
}

export interface SecretBinding extends BaseBinding {
  family: 'secrets';
  name: string;
  secret_ref?: string;
  value?: string;
  is_masked?: boolean;
}

export type RuntimeBinding =
  | D1Binding
  | KVBinding
  | R2Binding
  | DurableObjectBinding
  | WorkersAIBinding
  | BrowserBinding
  | VectorizeBinding
  | QueueBinding
  | WorkflowBinding
  | ServiceBinding
  | AnalyticsEngineBinding
  | EnvVarBinding
  | SecretBinding;

export interface BindingFamilyMeta {
  family: BindingFamily;
  label: string;
  icon: string;
  badgeColor: string;
  category: 'AI & Search' | 'Storage & DB' | 'Compute & DO' | 'Network & Infra' | 'Vars & Secrets';
  description: string;
  exampleBinding: string;
}

export const BINDING_FAMILY_META: Record<BindingFamily, BindingFamilyMeta> = {
  d1: {
    family: 'd1',
    label: 'D1 SQL Database',
    icon: 'database',
    badgeColor: '#38bdf8',
    category: 'Storage & DB',
    description: 'Serverless SQLite database with global read replicas and ACID guarantees.',
    exampleBinding: 'DB',
  },
  kv: {
    family: 'kv',
    label: 'KV Namespace',
    icon: 'folder_zip',
    badgeColor: '#f59e0b',
    category: 'Storage & DB',
    description: 'Ultra-low latency global key-value storage for cached sessions & tokens.',
    exampleBinding: 'CACHE_KV',
  },
  r2: {
    family: 'r2',
    label: 'R2 Object Bucket',
    icon: 'cloud_upload',
    badgeColor: '#8b5cf6',
    category: 'Storage & DB',
    description: 'S3-compatible zero-egress object storage for artifacts, logs, and uploads.',
    exampleBinding: 'ARTIFACTS_BUCKET',
  },
  durable_object: {
    family: 'durable_object',
    label: 'Durable Object',
    icon: 'memory',
    badgeColor: '#ec4899',
    category: 'Compute & DO',
    description: 'Stateful actor with persistent SQLite storage and guaranteed single-instance coordination.',
    exampleBinding: 'AGENT_SESSION_DO',
  },
  ai: {
    family: 'ai',
    label: 'Workers AI (GLM / Llama)',
    icon: 'psychology',
    badgeColor: '#10b981',
    category: 'AI & Search',
    description: 'Serverless GPU inference engine with AI Gateway spend tracking and model fallback.',
    exampleBinding: 'AI',
  },
  browser: {
    family: 'browser',
    label: 'Browser / Browser Run',
    icon: 'devices',
    badgeColor: '#06b6d4',
    category: 'AI & Search',
    description: 'Autonomous browser verification via Kitesurf Worker Browser & real Chromium CDP.',
    exampleBinding: 'MYBROWSER',
  },
  vectorize: {
    family: 'vectorize',
    label: 'Vectorize Index',
    icon: 'hub',
    badgeColor: '#6366f1',
    category: 'AI & Search',
    description: 'High-dimension vector database for semantic search, embeddings, and RAG.',
    exampleBinding: 'VECTOR_INDEX',
  },
  queue: {
    family: 'queue',
    label: 'Cloudflare Queue',
    icon: 'alt_route',
    badgeColor: '#14b8a6',
    category: 'Compute & DO',
    description: 'Guaranteed message delivery and batch processing without managing message brokers.',
    exampleBinding: 'MISSION_EVENTS_QUEUE',
  },
  workflow: {
    family: 'workflow',
    label: 'Cloudflare Workflow',
    icon: 'schema',
    badgeColor: '#a855f7',
    category: 'Compute & DO',
    description: 'Resilient multi-step durable workflows with automatic retry, sleep, and state persistence.',
    exampleBinding: 'AUDIT_WORKFLOW',
  },
  service: {
    family: 'service',
    label: 'Service Binding',
    icon: 'cable',
    badgeColor: '#f97316',
    category: 'Network & Infra',
    description: 'Direct zero-latency RPC calls to another sovereign Worker without leaving the isolate edge.',
    exampleBinding: 'AUTH_SERVICE',
  },
  analytics_engine: {
    family: 'analytics_engine',
    label: 'Analytics Engine',
    icon: 'query_stats',
    badgeColor: '#84cc16',
    category: 'Network & Infra',
    description: 'High-cardinality time-series analytics and telemetry logging at hyper-scale.',
    exampleBinding: 'TELEMETRY_DATASET',
  },
  vars: {
    family: 'vars',
    label: 'Environment Variable',
    icon: 'tune',
    badgeColor: '#64748b',
    category: 'Vars & Secrets',
    description: 'Plaintext runtime environment parameters, feature flags, and endpoints.',
    exampleBinding: 'ENVIRONMENT',
  },
  secrets: {
    family: 'secrets',
    label: 'Encrypted Secret',
    icon: 'lock',
    badgeColor: '#ef4444',
    category: 'Vars & Secrets',
    description: 'Encrypted API keys and sensitive credentials (never committed in plaintext).',
    exampleBinding: 'CLOUDFLARE_API_TOKEN',
  },
};

export const DEFAULT_RUNTIME_BINDINGS: RuntimeBinding[] = [
  {
    id: 'bind-ai-1',
    family: 'ai',
    binding: 'AI',
    enabled: true,
    environment: 'all',
    description: 'Primary Workers AI gateway for GLM-5.3 Flash & Gemini reasoning',
    status: 'active',
    model_routing: 'auto',
    gateway_id: 'agentsam-primary-gateway',
  },
  {
    id: 'bind-browser-1',
    family: 'browser',
    binding: 'MYBROWSER',
    enabled: true,
    environment: 'all',
    description: 'Dual-engine browser verifier (Kitesurf Worker + Chromium CDP)',
    status: 'active',
    engine: 'kitesurf_worker',
    session_timeout_sec: 120,
  },
  {
    id: 'bind-d1-1',
    family: 'd1',
    binding: 'DB',
    enabled: true,
    environment: 'all',
    description: 'Primary SQLite relational storage for missions, telemetry & audit trails',
    status: 'bound',
    database_name: 'agentsam_production_db',
    database_id: 'd1-9f82a1b4-4e32-411a-bf21-99c0d512a84e',
    migrations_dir: './d1/migrations',
  },
  {
    id: 'bind-kv-1',
    family: 'kv',
    binding: 'CACHE_KV',
    enabled: true,
    environment: 'all',
    description: 'Sub-millisecond token cache & transient VFS index store',
    status: 'bound',
    namespace_id: 'kv-01a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6',
  },
  {
    id: 'bind-r2-1',
    family: 'r2',
    binding: 'ARTIFACTS_BUCKET',
    enabled: true,
    environment: 'all',
    description: 'S3-compatible bucket storing diff artifacts, build outputs & reports',
    status: 'bound',
    bucket_name: 'agentsam-artifacts-prod',
    jurisdiction: 'default',
  },
  {
    id: 'bind-do-1',
    family: 'durable_object',
    binding: 'AGENT_SESSION_DO',
    enabled: true,
    environment: 'all',
    description: 'Stateful coordinator managing live agent sessions & filesystem locks',
    status: 'configured',
    class_name: 'AgentSessionCoordinator',
  },
  {
    id: 'bind-vec-1',
    family: 'vectorize',
    binding: 'VECTOR_INDEX',
    enabled: true,
    environment: 'all',
    description: 'Vector embeddings index for code AST symbols & semantic file search',
    status: 'bound',
    index_name: 'agentsam-codebase-embeddings',
    dimensions: 1536,
    metric: 'cosine',
  },
  {
    id: 'bind-queue-1',
    family: 'queue',
    binding: 'MISSION_EVENTS_QUEUE',
    enabled: false,
    environment: 'production',
    description: 'Asynchronous event stream for telemetry logging and background audits',
    status: 'unbound',
    queue_name: 'agentsam-mission-events',
    max_batch_size: 10,
    max_batch_timeout: 5,
    role: 'producer',
  },
  {
    id: 'bind-var-1',
    family: 'vars',
    binding: 'ENVIRONMENT',
    name: 'ENVIRONMENT',
    value: 'production',
    enabled: true,
    environment: 'all',
    description: 'Deployment target environment',
    status: 'active',
  },
  {
    id: 'bind-var-2',
    family: 'vars',
    binding: 'CODE_MODE_ENABLED',
    name: 'CODE_MODE_ENABLED',
    value: 'true',
    enabled: true,
    environment: 'all',
    description: 'Enable Cloudflare Code Mode single-turn tool composition',
    status: 'active',
  },
  {
    id: 'bind-sec-1',
    family: 'secrets',
    binding: 'CLOUDFLARE_API_TOKEN',
    name: 'CLOUDFLARE_API_TOKEN',
    secret_ref: 'vault://cf-tokens/agentsam-runtime',
    value: 'cf_sec_99a8b7c6d5e4f3a2b1',
    is_masked: true,
    enabled: true,
    environment: 'all',
    description: 'Encrypted Cloudflare Gateway & Workers API invocation token',
    status: 'active',
    isSecret: true,
  },
];

export interface BindingPreset {
  id: string;
  name: string;
  description: string;
  badge: string;
  bindings: RuntimeBinding[];
}

export const BINDING_PRESETS: BindingPreset[] = [
  {
    id: 'agentsam-complete',
    name: 'AgentSam Complete AI Stack',
    description: 'Full sovereign agent harness with D1, Workers AI, Browser Run, Vectorize, KV, DO & Secrets',
    badge: 'Recommended',
    bindings: DEFAULT_RUNTIME_BINDINGS,
  },
  {
    id: 'fullstack-ai-d1',
    name: 'Full-Stack AI + Vectorize + D1',
    description: 'High-performance conversational coding backend with relational SQL & vector search',
    badge: 'Popular',
    bindings: DEFAULT_RUNTIME_BINDINGS.filter(b => ['ai', 'd1', 'vectorize', 'kv', 'vars', 'secrets'].includes(b.family)),
  },
  {
    id: 'browser-automation',
    name: 'Browser Automation & Testing',
    description: 'Optimized for Kitesurf worker browser snapshots & Chromium CDP screenshot verification',
    badge: 'Specialized',
    bindings: DEFAULT_RUNTIME_BINDINGS.filter(b => ['browser', 'kv', 'r2', 'vars', 'secrets'].includes(b.family)),
  },
  {
    id: 'workflows-queues',
    name: 'Resilient Workflows & Queues',
    description: 'Durable multi-step execution pipeline with automatic retries and message queuing',
    badge: 'Async',
    bindings: DEFAULT_RUNTIME_BINDINGS.filter(b => ['durable_object', 'queue', 'workflow', 'd1', 'vars'].includes(b.family)),
  },
  {
    id: 'minimal-worker',
    name: 'Minimal Lightweight Worker',
    description: 'Bare essentials for ultra-fast edge execution (KV cache + Environment variables)',
    badge: 'Minimal',
    bindings: DEFAULT_RUNTIME_BINDINGS.filter(b => ['kv', 'vars'].includes(b.family)),
  },
];
