export type AppMode = 'chat' | 'work';
export type FlexLayoutMode = 'split' | 'single' | 'phone';
export type WorkSubTab = 'workbench' | 'presentations' | 'websites' | 'dashboards' | 'brand' | 'team' | 'telemetry';
export type ModelChoice = 'gemini-3.5-flash' | 'gemini-3.1-pro-preview' | 'gemini-3.1-flash-lite' | 'antigravity' | 'codex';

export type WorkbenchViewLevel = 'inbox' | 'workspace' | 'pr_review';

export interface WorkbenchChangedFile {
  id: string;
  filename: string;
  path: string;
  status: 'modified' | 'added' | 'deleted';
  additions: number;
  deletions: number;
  diffLines: {
    type: 'add' | 'del' | 'normal' | 'header';
    oldLine?: number;
    newLine?: number;
    content: string;
  }[];
}

export interface WorkbenchPullRequest {
  id: string;
  number: number;
  title: string;
  branch: string;
  targetBranch: string;
  author: string;
  authorAvatar?: string;
  status: 'in_review' | 'merged' | 'working' | 'needs_attention';
  createdAt: string;
  updatedAt: string;
  summary: string;
  specMarkdown: string;
  additions: number;
  deletions: number;
  files: WorkbenchChangedFile[];
}

export interface WorkbenchWorkspace {
  id: string;
  name: string;
  repoName: string;
  itemCount: number;
  description: string;
  statusSummary: {
    working: number;
    inReview: number;
    needsAttention: number;
  };
  lastActive: string;
  pullRequests: WorkbenchPullRequest[];
}

export interface PwaCacheStatus {
  swRegistered: boolean;
  swStatus: 'active' | 'installing' | 'redundant';
  cacheEngine: 'Workbox CacheFirst (Versioned)' | 'Unconditional Purge (Legacy)';
  startupPurgeDisabled: boolean;
  nonBlockingMount: boolean;
  shellCached: boolean;
  lazyMonacoWarmed: boolean;
  lazyXtermWarmed: boolean;
  lazyThreeWarmed: boolean;
  cacheSizeKb: number;
}

export type ExecutionLane = 'local_mac' | 'gcp_vm' | 'cloud_sandbox';

export interface ExecOsEnvironmentVariable {
  key: string;
  value: string;
  source: 'sanitized_config' | 'cursor_leak' | 'shell_inherited' | 'gcp_secret';
  isSafe: boolean;
  description: string;
}

export interface ExecOsLocalLaneStatus {
  activeLane: ExecutionLane;
  isConnected: boolean;
  latencyMs: number;
  daemonPort: number;
  tunnelUrl: string;
  workerUrl: string;
  macUsername: string;
  defaultCwd: string;
  uptime: string;
  pm2ProcessName: string;
  pm2Pid: number;
  isEcosystemSanitized: boolean;
  cursorBleedDetected: boolean;
  totalInheritedEnvVars: number;
  sanitizedEnvVars: ExecOsEnvironmentVariable[];
  bloatedEnvVarsSample: ExecOsEnvironmentVariable[];
  sshMode: 'scoped_git_key' | 'inherited_launchd_socket' | 'sandboxed';
  sshAuthSockPath: string;
  fsPermissionsSecure: boolean;
  allowedTenants: string[];
  mcpFsRoots: string[];
  operatorRepoPaths: string[];
  recentLocalCommands: {
    id: string;
    command: string;
    cwd: string;
    exitCode: number;
    durationMs: number;
    timestamp: string;
    output: string;
  }[];
}

// ----------------------------------------------------
// 1. Web Search Capability Types (Information Retrieval)
// ----------------------------------------------------
export interface WebSearchSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  favicon?: string;
  relevanceScore?: number;
}

export interface WebSearchInspectData {
  queries: string[];
  provider: 'Tavily basic' | 'OpenAI Web' | 'Google Search' | 'Perplexity API';
  sourcesCount: number;
  cachedResultsCount: number;
  cacheHit: boolean;
  latencyMs: number;
  costCredits: string;
  fallbackReason?: string;
  sources: WebSearchSource[];
}

export interface WebSearchEvent {
  id: string;
  title: string; // e.g. "Searched the web"
  summaryLabel: string; // e.g. "6 sources · Tavily basic · 1 cached result"
  timestamp: string;
  inspectData: WebSearchInspectData;
}

// ----------------------------------------------------
// 2. Live Browser Capability Types (Remote Chromium / Cloudflare Live View)
// ----------------------------------------------------
export type BrowserControlMode = 'agent' | 'user';
export type BrowserLiveViewMode = 'tab' | 'full' | 'devtools';

export interface BrowserNavigationEvent {
  id: string;
  timestamp: string;
  statusText: string;
  url?: string;
  action?: string;
}

export interface LiveBrowserSession {
  sessionId: string;
  agentRunId: string;
  targetUrl: string;
  pageTitle: string;
  status: 'starting' | 'ready' | 'navigating' | 'waiting_for_user' | 'user_controlling' | 'completed';
  controlMode: BrowserControlMode;
  liveViewMode: BrowserLiveViewMode;
  liveViewUrl?: string;
  screenshotThumbnailUrl?: string;
  viewportDimensions: { width: number; height: number };
  eventsTimeline: BrowserNavigationEvent[];
  consoleLogs: { level: 'info' | 'warn' | 'error'; message: string; timestamp: string }[];
  sslSecured: boolean;
}

// ----------------------------------------------------
// 3. Agent Computer Capability Types (Composed Environment Surface)
// ----------------------------------------------------
export type AgentComputerTab = 'browser' | 'terminal' | 'files' | 'artifacts';

export interface AgentComputerState {
  id: string;
  activeTab: AgentComputerTab;
  browserSession?: LiveBrowserSession;
  terminalSessionId: string;
  activeLane: ExecutionLane;
  workingPath: string;
  workingBranch: string;
  changedFilesCount: number;
  artifactsCount: number;
}

// ----------------------------------------------------
// 4. Terminal Ownership & Snap State Types
// ----------------------------------------------------
export type TerminalSnapPosition = 'peek' | 'split' | 'full';
export type TerminalOwnershipState = 'idle' | 'agent_controlling' | 'user_controlling';

export interface TaskStepItem {
  id: string;
  type: 'read' | 'edit' | 'command' | 'generate';
  label: string;
  sublabel?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  time?: string;
  details?: string;
}

export interface TaskTrace {
  id: string;
  title: string;
  status: 'running' | 'completed' | 'error';
  filesReadCount?: number;
  filesEditedCount?: number;
  command?: {
    cmd: string;
    location: string;
    duration?: string;
    passed?: number;
    failed?: number;
    summary?: string;
  };
  steps?: TaskStepItem[];
  outputSnippet?: string;
  artifactRef?: {
    type: 'presentation' | 'website' | 'dashboard' | 'brand' | 'image' | 'video';
    id: string;
    title: string;
  };
}

export interface ChatCitation {
  id: string;
  sourceIndex: number;
  url: string;
  domain: string;
  title: string;
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'agent' | 'collaborator' | 'system';
  authorName: string;
  authorInitials: string;
  authorAvatarBg?: string;
  timestamp: string;
  content: string;
  taskTrace?: TaskTrace;
  webSearchEvent?: WebSearchEvent;
  liveBrowserSession?: LiveBrowserSession;
  agentComputerState?: AgentComputerState;
  citations?: ChatCitation[];
  reactions?: string[];
  attachments?: {
    name: string;
    type: 'image' | 'file' | 'code' | 'video';
    url?: string;
  }[];
}

export interface SlideItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  bullets: string[];
  metrics?: { label: string; value: string; trend?: string }[];
  quote?: { text: string; author: string };
  callToAction?: string;
  accentColor?: string;
}

export interface PresentationDeck {
  id: string;
  title: string;
  client: string;
  version: string;
  lastUpdated: string;
  slides: SlideItem[];
}

export type SiteBlockType = 
  | 'navbar' 
  | 'hero' 
  | 'stats' 
  | 'features' 
  | 'bento' 
  | 'pricing' 
  | 'testimonials' 
  | 'faq' 
  | 'leadCapture' 
  | 'ctaBanner' 
  | 'footer';

export interface SiteBlock {
  id: string;
  type: SiteBlockType;
  name: string;
  enabled: boolean;
  badge?: string;
  headline?: string;
  subheadline?: string;
  primaryCtaText?: string;
  primaryCtaUrl?: string;
  secondaryCtaText?: string;
  secondaryCtaUrl?: string;
  mediaUrl?: string;
  align?: 'left' | 'center' | 'right';
  customStyles?: {
    backgroundColor?: string;
    textColor?: string;
    paddingY?: 'sm' | 'md' | 'lg';
  };
}

export interface SiteThemeConfig {
  primaryColor: string;
  accentColor: string;
  backgroundTheme: 'light' | 'dark' | 'midnight' | 'mesh' | 'warm';
  fontFamily: 'sans' | 'serif' | 'mono';
  borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'full';
  showGridLines: boolean;
}

export interface SiteDeploymentInfo {
  status: 'idle' | 'building' | 'deployed' | 'error';
  subdomain: string;
  deployedUrl: string;
  customDomain?: string;
  lastDeployedAt: string;
  version: string;
  sslStatus: 'active' | 'provisioning';
  edgeRegion: string;
  commitHash: string;
  buildLogs?: string[];
}

export interface SiteFaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface SiteStatItem {
  id: string;
  label: string;
  value: string;
  change?: string;
}

export interface SiteFeatureItem {
  id: string;
  icon: string;
  title: string;
  desc: string;
  tag?: string;
}

export interface SitePricingTier {
  id: string;
  name: string;
  price: string;
  annualPrice?: string;
  period: string;
  description?: string;
  features: string[];
  popular?: boolean;
  ctaText?: string;
}

export interface SiteTestimonial {
  id: string;
  quote: string;
  author: string;
  role: string;
  avatar: string;
  company?: string;
  rating?: number;
}

export interface SiteCmsSnapshot {
  id: string;
  timestamp: string;
  title: string;
  siteData: ClientWebsiteData;
}

export interface ClientWebsiteData {
  id: string;
  title: string;
  clientName: string;
  tagline: string;
  heroHeadline: string;
  heroSubheadline: string;
  primaryCta: string;
  primaryCtaUrl?: string;
  secondaryCta: string;
  secondaryCtaUrl?: string;
  accentColor: string;
  theme: SiteThemeConfig;
  blocks: SiteBlock[];
  features: SiteFeatureItem[];
  pricingTiers: SitePricingTier[];
  testimonials: SiteTestimonial[];
  faqs: SiteFaqItem[];
  stats: SiteStatItem[];
  navLinks: { id: string; label: string; href: string }[];
  seo: {
    metaTitle: string;
    metaDescription: string;
    ogImage?: string;
  };
  deployment: SiteDeploymentInfo;
  snapshots?: SiteCmsSnapshot[];
}

export interface SitePresetTemplate {
  id: string;
  name: string;
  industry: string;
  description: string;
  category: 'saas' | 'agency' | 'developer' | 'fintech' | 'ecommerce';
  badge: string;
  accentColor: string;
  website: ClientWebsiteData;
}

export interface DashboardMetric {
  id: string;
  label: string;
  value: string;
  change: string;
  isPositive: boolean;
  timeframe: string;
  sparkline: number[];
}

export interface GeneratedImageItem {
  id: string;
  prompt: string;
  imageUrl: string;
  model: string;
  aspectRatio: string;
  timestamp: string;
  tags: string[];
}

export interface GeneratedVideoItem {
  id: string;
  prompt: string;
  videoUrl?: string;
  posterUrl: string;
  aspectRatio: '16:9' | '9:16';
  duration: string;
  status: 'ready' | 'rendering';
  model: string;
  timestamp: string;
}

export interface BrandKitData {
  brandName: string;
  tagline: string;
  mission: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  neutralDark: string;
  neutralLight: string;
  fontHeading: string;
  fontBody: string;
  logoKeywords: string[];
  generatedImages: GeneratedImageItem[];
  generatedVideos: GeneratedVideoItem[];
}

export interface CollaboratorAgent {
  id: string;
  name: string;
  role: string;
  initials: string;
  color: string;
  status: 'active' | 'executing' | 'idle';
  currentAction: string;
}

// ----------------------------------------------------
// Dynamic Environment & Runtime Configuration Types
// ----------------------------------------------------
export interface AppConfig {
  appTitle: string;
  appName: string;
  agentName: string;
  agentRole: string;
  agentInitials: string;
  developerName: string;
  developerInitials: string;
  developerEmail: string;
  organization: string;
  activeTenant: string;
  defaultBranch: string;
  defaultPath: string;
  execOsPort: number;
  execOsTunnelUrl: string;
  execOsWorkerUrl: string;
  macUsername: string;
  clientBrandName: string;
  clientTagline: string;
  clientMission: string;
  defaultModel: ModelChoice;
  edgeRegion: string;
  apiBaseUrl: string;
  environment: 'development' | 'production' | 'test' | 'preview';
}
