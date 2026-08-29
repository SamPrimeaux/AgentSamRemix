/**
 * Agent Sam SDK - Core Portable Types & Contracts
 * @package @inneranimalmedia/agentsam-sdk
 * @version 2.0.0-alpha.identity.11
 */

// ==========================================
// 1. Mission Lifecycle & States
// ==========================================

export type MissionLifecycleState =
  | 'created'
  | 'preparing'
  | 'inspecting'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'review_ready'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ImageClassificationType =
  | 'UI_MOCKUP'
  | 'ARCHITECTURE_DIAGRAM'
  | 'ERROR_LOG_TRACE'
  | 'CODE_SNIPPET'
  | 'GENERAL_TECHNICAL';

export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  uploadedAt: number;
  previewUrl?: string;
}

export interface ImageAnalysisResult {
  id: string;
  attachmentId: string;
  classification: ImageClassificationType;
  confidence: number; // 0.0 - 1.0
  title: string;
  summary: string;
  ocrText?: string;
  detectedEntities: string[];
  suggestedActions: string[];
  suggestedMissionPrompt: string;
  codeSnippetProposal?: string;
  technicalDetails?: Record<string, any>;
  analyzedAt: number;
}

export interface MissionGoal {
  id: string;
  title: string;
  description: string;
  targetRepo: string;
  targetBranch?: string;
  workingBranch?: string;
  isSelfHosting?: boolean;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  images?: ImageAttachment[];
}

export interface MissionPlanStep {
  id: string;
  title: string;
  phase: 'inspect' | 'reason' | 'act' | 'observe' | 'adjust' | 'verify';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  estimatedDurationMs?: number;
  actualDurationMs?: number;
  toolCallKey?: string;
  description?: string;
}

export interface Mission {
  id: string;
  goal: MissionGoal;
  state: MissionLifecycleState;
  plan: MissionPlanStep[];
  activeStepIndex: number;
  environmentId: string;
  modelTier: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  totalTokens: {
    input: number;
    output: number;
    cached: number;
  };
  totalCostUsd: number;
  toolCallCount: number;
  artifacts: Artifact[];
  attachedImages?: ImageAttachment[];
  imageAnalyses?: ImageAnalysisResult[];
  pendingApproval?: ApprovalRequest;
  evolutionReport?: EvolutionReport;
  error?: string;
}

// ==========================================
// 2. Typed Execution Events
// ==========================================

export type ExecutionEventFamily =
  | 'environment.preparing'
  | 'environment.ready'
  | 'mission.started'
  | 'mission.plan.updated'
  | 'image.uploaded'
  | 'image.analyzing'
  | 'image.classified'
  | 'repository.search'
  | 'repository.read'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'file.edited'
  | 'terminal.started'
  | 'terminal.output'
  | 'terminal.completed'
  | 'test.started'
  | 'test.completed'
  | 'browser.started'
  | 'browser.verified'
  | 'artifact.created'
  | 'verification.started'
  | 'verification.passed'
  | 'verification.failed'
  | 'mission.completed';

export interface BaseExecutionEvent {
  id: string;
  missionId: string;
  timestamp: number;
  type: ExecutionEventFamily;
  title: string;
  summary: string;
  environmentId: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export interface ToolExecutionEvent extends BaseExecutionEvent {
  toolKey: string;
  riskLevel: ToolRiskLevel;
  input: Record<string, any>;
  output?: Record<string, any>;
  error?: string;
  receiptId: string;
}

export interface TerminalExecutionEvent extends BaseExecutionEvent {
  command: string;
  cwd: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface FileEditedEvent extends BaseExecutionEvent {
  path: string;
  diffSummary: string;
  linesAdded: number;
  linesRemoved: number;
  previousContent?: string;
  newContent?: string;
}

export interface TestExecutionEvent extends BaseExecutionEvent {
  suiteName: string;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  durationMs: number;
  failures?: Array<{ name: string; message: string; stack?: string }>;
}

export interface BrowserVerifiedEvent extends BaseExecutionEvent {
  url: string;
  viewport: { width: number; height: number };
  screenshotUrl?: string;
  domHealth: 'clean' | 'warnings' | 'errors';
  accessibilityScore: number;
  consoleErrors: string[];
}

export type ExecutionEvent =
  | BaseExecutionEvent
  | ToolExecutionEvent
  | TerminalExecutionEvent
  | FileEditedEvent
  | TestExecutionEvent
  | BrowserVerifiedEvent;

// ==========================================
// 3. Execution Environments Contract
// ==========================================

export type EnvironmentKind =
  | 'local'
  | 'cloudflare_computer'
  | 'cloudflare_container'
  | 'remote_vm'
  | 'google_antigravity';

export interface EnvironmentCapabilities {
  filesystem: boolean;
  terminal: boolean;
  browser: boolean;
  network: boolean;
  git: boolean;
  isolated: boolean;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  networkRequests?: Array<{ url: string; method: string; status: number }>;
}

export interface ExecutionEnvironment {
  id: string;
  kind: EnvironmentKind;
  name: string;
  status: 'offline' | 'starting' | 'ready' | 'busy' | 'error';
  capabilities(): Promise<EnvironmentCapabilities>;
  prepare(): Promise<void>;
  exec(command: string, options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<ExecutionResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(pattern?: string): Promise<string[]>;
  dispose?(): Promise<void>;
}

// ==========================================
// 4. Repository Intelligence Contract
// ==========================================

export interface FileMetadata {
  path: string;
  sizeBytes: number;
  lineCount: number;
  language: string;
  lastModifiedMs: number;
  gitChurnScore: number;
  isTest: boolean;
  isGenerated: boolean;
  imports: string[];
  importedBy: string[];
}

export interface GodFileCandidate {
  path: string;
  reason: string;
  loc: number;
  incomingReferences: number;
  distinctResponsibilities: string[];
}

export interface DuplicateAuthoritySignal {
  domain: string;
  description: string;
  filesInvolved: string[];
  recommendation: string;
}

export interface RepositoryIntelligenceReport {
  repoName: string;
  branch: string;
  commitHash: string;
  generatedAt: number;
  summary: {
    totalFiles: number;
    totalLoc: number;
    totalLanguages: number;
    testCoverageRatio: number;
    healthScore: number; // 0 - 100
  };
  languageDistribution: Record<string, { files: number; loc: number; percentage: number }>;
  largeFiles: Array<{ path: string; loc: number; sizeKb: number }>;
  hotFilesByGitChurn: Array<{ path: string; commitsInLast30Days: number; churnScore: number }>;
  staleFiles: Array<{ path: string; daysSinceLastTouch: number }>;
  godFileCandidates: GodFileCandidate[];
  duplicateAuthoritySignals: DuplicateAuthoritySignal[];
  directoryDensity: Array<{ directory: string; fileCount: number; averageLoc: number }>;
  dependencyPressure: {
    directDependencies: number;
    devDependencies: number;
    vulnerabilities: { low: number; moderate: number; high: number; critical: number };
    circularDependencies: string[][];
  };
  workspaceTopology: {
    isMonorepo: boolean;
    packages: Array<{ name: string; path: string; loc: number }>;
  };
}

// ==========================================
// 5. Tool Registry & Safety
// ==========================================

export type ToolCategory =
  | 'filesystem'
  | 'terminal'
  | 'git'
  | 'github'
  | 'browser'
  | 'http'
  | 'database'
  | 'cloudflare'
  | 'artifacts'
  | 'search'
  | 'mcp';

export type ToolRiskLevel =
  | 'READ'
  | 'WRITE'
  | 'EXECUTE'
  | 'EXTERNAL_EFFECT'
  | 'DESTRUCTIVE';

export interface ToolMetadata {
  key: string;
  title: string;
  description: string;
  category: ToolCategory;
  risk: ToolRiskLevel;
  environmentRequirements: Partial<EnvironmentCapabilities>;
  inputSchema: Record<string, any>;
  outputSchema: Record<string, any>;
  requiresApproval?: boolean;
}

export interface ApprovalRequest {
  id: string;
  missionId: string;
  toolKey: string;
  riskLevel: ToolRiskLevel;
  actionSummary: string;
  parameters: Record<string, any>;
  diff?: string;
  requestedAt: number;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt?: number;
  decidedBy?: string;
  comment?: string;
}

export interface ExecutionReceipt {
  id: string;
  missionId: string;
  toolKey: string;
  timestamp: number;
  durationMs: number;
  environmentId: string;
  status: 'success' | 'failed' | 'rejected';
  riskLevel: ToolRiskLevel;
  inputSnapshot: Record<string, any>;
  outputSnapshot?: Record<string, any>;
  error?: string;
  approvalId?: string;
}

// ==========================================
// 6. Self-Hosting & Evolution Manifest
// ==========================================

export interface EvolutionBenchmark {
  metric: string;
  unit: string;
  before: number;
  after: number;
  deltaPercent: number;
  improved: boolean;
}

export interface RegressionGateResult {
  gate: 'typecheck' | 'unit_tests' | 'integration_tests' | 'contract_tests' | 'build' | 'lint' | 'secret_scan' | 'safety_audit';
  passed: boolean;
  details: string;
  durationMs: number;
}

export interface EvolutionReport {
  id: string;
  missionId: string;
  timestamp: number;
  baseVersion: string;
  candidateVersion: string;
  objective: string;
  hypothesis: string;
  branchName: string;
  filesChanged: string[];
  publicContractsAffected: string[];
  testsAdded: number;
  testsPassed: number;
  regressionGates: RegressionGateResult[];
  benchmarks: EvolutionBenchmark[];
  tokenUsage: {
    input: number;
    output: number;
    costUsd: number;
  };
  toolCallsTotal: number;
  executionDurationMs: number;
  unresolvedConcerns: string[];
  readyForPromotion: boolean;
  promotionChoice?: 'leave_changes' | 'commit_branch' | 'open_pr';
}

// ==========================================
// 7. Identity & User
// ==========================================

export interface IAMUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: 'owner' | 'engineer' | 'operator' | 'viewer';
  companyId: string;
  companyName: string;
  authProvider: 'iam' | 'google' | 'github' | 'email';
  createdAt: string;
  lastActiveAt: string;
  permissions: string[];
}

export interface AuthSession {
  token: string;
  user: IAMUser;
  expiresAt: number;
}

export interface Artifact {
  id: string;
  name: string;
  type: 'diff' | 'report' | 'screenshot' | 'svg' | 'json' | 'log';
  content: string;
  sizeBytes: number;
  createdAt: number;
}
