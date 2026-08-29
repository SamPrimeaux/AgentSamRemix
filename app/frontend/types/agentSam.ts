export type BackendType = 'cloudflare_computer' | 'antigravity' | 'cloudflare' | 'local_pty' | 'gcp_vm';

export type ModelTier = 'glm_5_3_flash' | 'glm_5_3' | 'gemini_3_7_flash' | 'claude_3_7_sonnet';

export interface ModelTierConfig {
  id: ModelTier;
  name: string;
  provider: 'Cloudflare Workers AI' | 'Google AI' | 'Anthropic';
  role: 'Default Workhorse' | 'Escalation / Complex' | 'Provider Fallback' | 'External High-End';
  inputPricePerM: number;
  cachedInputPricePerM: number;
  outputPricePerM: number;
  contextWindow: string;
  description: string;
  badgeColor: string;
}

export const MODEL_TIER_CONFIGS: Record<ModelTier, ModelTierConfig> = {
  glm_5_3_flash: {
    id: 'glm_5_3_flash',
    name: 'GLM-5.3 Flash (Cloudflare)',
    provider: 'Cloudflare Workers AI',
    role: 'Default Workhorse',
    inputPricePerM: 0.15,
    cachedInputPricePerM: 0.03,
    outputPricePerM: 0.50,
    contextWindow: '1,048,576 tokens (1M)',
    description: 'Fast, high-efficiency agentic coding model approaching Claude Opus 4.8 benchmark levels at 1/10th the cost.',
    badgeColor: '#10b981',
  },
  glm_5_3: {
    id: 'glm_5_3',
    name: 'GLM-5.3 (Cloudflare)',
    provider: 'Cloudflare Workers AI',
    role: 'Escalation / Complex',
    inputPricePerM: 1.40,
    cachedInputPricePerM: 0.26,
    outputPricePerM: 4.40,
    contextWindow: '1,048,576 tokens (1M)',
    description: 'Flagship agentic reasoning model with deep terminal and multi-step SWE benchmark capabilities.',
    badgeColor: '#8b5cf6',
  },
  gemini_3_7_flash: {
    id: 'gemini_3_7_flash',
    name: 'Gemini 3.7 Flash',
    provider: 'Google AI',
    role: 'Provider Fallback',
    inputPricePerM: 0.75,
    cachedInputPricePerM: 0.18,
    outputPricePerM: 3.75,
    contextWindow: '1,048,576 tokens',
    description: 'Hybrid reasoning and standard generation model with high coding fidelity.',
    badgeColor: '#8ab4f8',
  },
  claude_3_7_sonnet: {
    id: 'claude_3_7_sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
    role: 'External High-End',
    inputPricePerM: 3.00,
    cachedInputPricePerM: 0.30,
    outputPricePerM: 15.00,
    contextWindow: '200,000 tokens',
    description: 'Premier frontier reasoning model for complex architectural analysis.',
    badgeColor: '#f59e0b',
  },
};

export interface BackendSpecs {
  name: string;
  tagline: string;
  cpu: string;
  ram: string;
  disk: string;
  provisionTimeMs: number;
  computeCostPerHour: number;
  freeTierNote: string;
  networkPolicy: 'Strict Allowlist' | 'Custom Cloudflare Gateway' | 'Unrestricted Local' | 'VPC Firewall' | 'Dual-Lane Isolated & Containerized';
  allowlist: string[];
  executionType?: 'dual_isolate_container' | 'container' | 'local' | 'vm';
}

export const BACKEND_CONFIGS: Record<BackendType, BackendSpecs> = {
  cloudflare_computer: {
    name: '@cloudflare/computer (Dual Router)',
    tagline: 'SQLite-backed filesystem with Worker isolate + lazy Linux container',
    cpu: 'Worker Isolate (instant) + ¼ vCPU Container',
    ram: '128 MB (Worker) / 1.0 GiB (Container)',
    disk: 'Persistent SQLite NVMe / 4 GB Sandbox',
    provisionTimeMs: 140,
    computeCostPerHour: 0.012,
    freeTierNote: 'Worker textual commands (grep/cat/sed) are near-free; Linux container reached lazily only for npm/vite/tests',
    networkPolicy: 'Dual-Lane Isolated & Containerized',
    allowlist: [
      'api.cloudflare.com',
      'registry.npmjs.org',
      'github.com',
      'files.pythonhosted.org',
      'pypi.org',
      'esm.sh'
    ],
    executionType: 'dual_isolate_container',
  },
  antigravity: {
    name: 'Google Antigravity (Managed)',
    tagline: 'Managed remote sandbox execution environment',
    cpu: '1.0 vCPU (Burst up to 4.0)',
    ram: '4.0 GiB RAM',
    disk: '16 GB Ephemeral NVMe',
    provisionTimeMs: 1800,
    computeCostPerHour: 0.0,
    freeTierNote: '$0.00 compute during preview (billed for Gemini tokens)',
    networkPolicy: 'Strict Allowlist',
    allowlist: [
      'files.pythonhosted.org',
      'pypi.org',
      'registry.npmjs.org',
      'github.com',
      'generativelanguage.googleapis.com',
      'esm.sh',
      'cdn.tailwindcss.com'
    ],
    executionType: 'container',
  },
  cloudflare: {
    name: 'Cloudflare Containers (Basic)',
    tagline: 'Workers Paid sovereign micro-container lane',
    cpu: '¼ vCPU',
    ram: '1.0 GiB RAM',
    disk: '4 GB Disk',
    provisionTimeMs: 3200,
    computeCostPerHour: 0.028,
    freeTierNote: 'Includes 25 GiB-hrs memory, 375 vCPU-mins, 200 GB-hrs disk on $5/mo plan',
    networkPolicy: 'Custom Cloudflare Gateway',
    allowlist: [
      'api.cloudflare.com',
      'registry.npmjs.org',
      'github.com',
      'files.pythonhosted.org',
      'pypi.org'
    ],
    executionType: 'container',
  },
  local_pty: {
    name: 'Local Mac / localpty',
    tagline: 'Direct hardware loop with zero cloud compute costs',
    cpu: 'Apple Silicon (M-Series)',
    ram: '16–64 GiB Unified',
    disk: 'Local APFS SSD',
    provisionTimeMs: 120,
    computeCostPerHour: 0.0,
    freeTierNote: 'Free hardware execution; full local file permissions',
    networkPolicy: 'Unrestricted Local',
    allowlist: ['* (Unrestricted)'],
    executionType: 'local',
  },
  gcp_vm: {
    name: 'GCP Compute Engine (e2-standard-2)',
    tagline: 'Dedicated cloud virtual machine instance',
    cpu: '2 vCPU',
    ram: '8.0 GiB RAM',
    disk: '50 GB Persistent Disk',
    provisionTimeMs: 12500,
    computeCostPerHour: 0.067,
    freeTierNote: 'Standard Google Cloud compute billing',
    networkPolicy: 'VPC Firewall',
    allowlist: ['Custom VPC Ingress/Egress'],
    executionType: 'vm',
  },
};

export type StepPhase =
  | 'env_init'
  | 'thought'
  | 'code_mode'
  | 'terminal'
  | 'tool_call'
  | 'network_egress'
  | 'browser_verification'
  | 'verification'
  | 'artifact_generation';

export interface CodeModeExecution {
  script: string;
  composedTools: string[];
  roundTripsSaved: number;
  resultSummary: string;
  durationMs: number;
}

export interface BrowserVerification {
  engine: 'kitesurf_worker' | 'browser_run_chromium';
  url: string;
  viewport: { width: number; height: number; device: string };
  accessibilityTree?: {
    nodesCount: number;
    ariaSnapshot: string;
    contrastPassed: boolean;
  };
  consoleErrors: string[];
  screenshotLabel?: string;
  status: 'passed' | 'warning' | 'failed';
}

export interface TerminalExecution {
  command: string;
  cwd: string;
  stdout: string;
  stderr?: string;
  exitCode: number;
  durationMs: number;
  backendLane?: 'worker_isolate' | 'linux_container' | 'local_pty';
}

export interface NetworkEgressLog {
  host: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'CONNECT';
  status: number;
  bytes: number;
  reason: string;
  allowed: boolean;
}

export interface FileDiffItem {
  action: 'read' | 'create' | 'modify' | 'audit';
  filePath: string;
  linesAnalyzed: number;
  snippet?: string;
}

export interface MissionStep {
  id: string;
  stepNumber: number;
  timestamp: string;
  phase: StepPhase;
  title: string;
  thoughtContent?: string;
  terminal?: TerminalExecution;
  codeMode?: CodeModeExecution;
  browserVerification?: BrowserVerification;
  network?: NetworkEgressLog;
  fileDiff?: FileDiffItem;
  subAgent?: 'Inspector' | 'Builder' | 'BrowserVerifier' | 'Orchestrator';
  durationMs: number;
  tokens: {
    input: number;
    output: number;
    thinking: number;
  };
}

export interface AuditIssue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  component: string;
  file: string;
  lines: string;
  description: string;
  recommendation: string;
}

export interface MissionReport {
  title: string;
  summary: string;
  totalDurationMs: number;
  filesInspected: string[];
  issuesFound: AuditIssue[];
  consolidationSequence: { step: number; title: string; detail: string; risk: 'low' | 'medium' | 'high' }[];
  architectureSvg: string;
  tokenSummary: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    totalTokens: number;
    modelCostUsd: number;
    computeCostUsd: number;
    totalCostUsd: number;
  };
}

export interface PresetMission {
  id: string;
  title: string;
  description: string;
  targetRepo: string;
  prompt: string;
}
