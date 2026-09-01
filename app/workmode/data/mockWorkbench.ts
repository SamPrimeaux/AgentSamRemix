import { WorkbenchWorkspace, WorkbenchPullRequest, PwaCacheStatus, ExecOsLocalLaneStatus, AppConfig } from '../types';
import { getEnvironmentConfig } from '../context/WorkModeConfigContext';

export function getDynamicWorkbenchPR1(customConfig?: Partial<AppConfig>): WorkbenchPullRequest {
  const cfg = { ...getEnvironmentConfig(), ...customConfig };
  return {
    id: 'pr-1',
    number: 1,
    title: 'Fix Startup Cache Purge & Serve Warmed JS',
    branch: 'fix/pwa-sw-caching',
    targetBranch: cfg.defaultBranch,
    author: cfg.agentName,
    authorAvatar: cfg.agentInitials,
    status: 'in_review',
    createdAt: '1 hour ago',
    updatedAt: '12m ago',
    summary: 'Deletes unconditional startup cache purge, transitions JS assets to Workbox CacheFirst with versioned cache_bust, and decouples SW bootstrap from React render.',
    specMarkdown: `### What I'd change

In order of impact:

#### 1. Delete the unconditional startup cache purge
Instead:
- **App starts** → keep caches
- **Manifest cache_bust differs** → purge old version → activate new SW

*That's probably your easiest major repeat-load win.*

---

#### 2. Make your warmed JS cache actually serve JS
Either have Workbox own it:
\`\`\`js
/static/dashboard/app/*.js
  → CacheFirst
  → cacheName versioned by deploy/cache_bust
\`\`\`
or add a proper fetch handler to \`sw-agent-cache.js\`.

*Workbox owning it avoids two competing cache systems.*

---

#### 3. Precache the actual minimum executable shell
**Precached Core:**
- \`index.html\`
- \`dashboard.js\`
- \`vendor-react.js\`
- \`vendor-icons.js\`
- \`dashboard.css\`
- \`shell.css\`
- \`manifest\`
- \`icons\`
- \`offline/recovery page\`

*(Not Monaco, Three.js, Excalidraw, Remotion, XTerm, etc.)*

**Keep heavy code lazy and intent-driven:**
- **tap Code** → warm Monaco
- **tap Terminal** → warm XTerm
- **tap Create/3D** → warm Three
- **tap Draw** → warm Excalidraw

*Then retain those caches instead of deleting them next launch.*

---

#### 4. Continue keeping these NetworkOnly:
- \`/api/*\`
- chat SSE
- terminal API / WS
- browser sessions
- collab
- OAuth
- auth mutations

---

#### 5. Stop tying SW registration to WorkspaceContext
Static caching doesn't need a workspace. The SW lifecycle shouldn't conceptually be:
\`\`\`
resolve workspace → user context → register PWA
\`\`\`
For \`/dashboard/*\`, registration happens independently of workspace state.

---

#### 6. Decouple blocking dashboard bootstrap
Currently \`index.tsx\` does:
\`\`\`ts
await ensureDashboardBootstrapBeforeMount();
\`\`\`
before React mounts, holding the UI hostage to \`/api/dashboard/bootstrap\`.

**Target execution flow:**
\`\`\`
cached app shell → React mounts immediately → route paints
  then: auth/session verifies & route-specific data loads
\`\`\`

---

### PR #1 Architectural Audit Table

| PR #1 Claim | Current Reality | Resolution Action |
|:---|:---|:---|
| **SW registration missing** | Already implemented | Keep existing registration, decouple from workspace |
| **Phase 1 services ingest planned** | Already live/built | Retain current live edge ingest |
| **Services push/session planned** | Should remain delegated | Keep delegated architecture |
| **Offline shell disabled** | SW/offline machinery exists, but caching policy prevents reliable boot | Fix cache invalidation to enable reliable boot |
| **Tiered caching strategy needed** | Already partly implemented, but JS cache not served | Wire Workbox \`CacheFirst\` for static JS |
| **P0: Startup Cache Purge** | *Missing from original PR* | **Added**: Retain caches across launches |
| **P0: JS Cache Serving** | *Missing from original PR* | **Added**: Serve warmed JS directly from cache |

---

### Target Benchmark Results
- **FIRST VISIT**: Network downloads small core shell (~180KB) → SW installs in background.
- **SECOND VISIT**: Shell + Core JS served instantly from device cache → UI paints in <45ms.
- **OFFLINE**: Core dashboard boots completely offline with cached routes & clear cloud state indicators.`,
    additions: 148,
    deletions: 42,
    files: [
      {
        id: 'f-1',
        filename: 'bootstrap.ts',
        path: 'src/bootstrap.ts',
        status: 'modified',
        additions: 24,
        deletions: 38,
        diffLines: [
          { type: 'header', content: '@@ -14,24 +14,10 @@ async function initApp() {' },
          { type: 'normal', content: '   // Register service worker independently of workspace resolution' },
          { type: 'del', oldLine: 15, content: '-  await ensureDashboardBootstrapBeforeMount();' },
          { type: 'del', oldLine: 16, content: '-  if (window.location.search.includes("purge")) {' },
          { type: 'del', oldLine: 17, content: '-    await caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));' },
          { type: 'del', oldLine: 18, content: '-  }' },
          { type: 'add', newLine: 15, content: '+  // Non-blocking background bootstrap with cache preservation' },
          { type: 'add', newLine: 16, content: '+  mountReactAppRootImmediately();' },
          { type: 'add', newLine: 17, content: '+  scheduleNonCriticalIngestBootstrap();' },
          { type: 'normal', content: '   registerServiceWorker({ immediate: true, cacheFirstJs: true });' }
        ]
      },
      {
        id: 'f-2',
        filename: 'sw-agent-cache.js',
        path: 'public/sw-agent-cache.js',
        status: 'modified',
        additions: 68,
        deletions: 4,
        diffLines: [
          { type: 'header', content: '@@ -1,8 +1,24 @@' },
          { type: 'normal', content: ' import { registerRoute } from "workbox-routing";' },
          { type: 'normal', content: ' import { CacheFirst, NetworkOnly } from "workbox-strategies";' },
          { type: 'add', newLine: 3, content: '+import { ExpirationPlugin } from "workbox-expiration";' },
          { type: 'normal', content: ' ' },
          { type: 'del', oldLine: 4, content: '-// JS Cache registered but no fetch interceptor wired' },
          { type: 'add', newLine: 5, content: '+// Workbox CacheFirst strategy for static JS bundles versioned by deploy' },
          { type: 'add', newLine: 6, content: '+registerRoute(' },
          { type: 'add', newLine: 7, content: '+  ({ request, url }) => request.destination === "script" && url.pathname.startsWith("/static/"),' },
          { type: 'add', newLine: 8, content: '+  new CacheFirst({' },
          { type: 'add', newLine: 9, content: '+    cacheName: "agent-js-v2",' },
          { type: 'add', newLine: 10, content: '+    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 })]' },
          { type: 'add', newLine: 11, content: '+  })' },
          { type: 'add', newLine: 12, content: '+);' }
        ]
      },
      {
        id: 'f-3',
        filename: 'ecosystem.config.cjs',
        path: 'ecosystem.config.cjs',
        status: 'added',
        additions: 56,
        deletions: 0,
        diffLines: [
          { type: 'header', content: '@@ -0,0 +1,24 @@' },
          { type: 'add', newLine: 1, content: '+module.exports = {' },
          { type: 'add', newLine: 2, content: '+  apps: [{' },
          { type: 'add', newLine: 3, content: '+    name: "execos",' },
          { type: 'add', newLine: 4, content: '+    script: "bin/daemon.js",' },
          { type: 'add', newLine: 5, content: '+    env: {' },
          { type: 'add', newLine: 6, content: '+      NODE_ENV: "production",' },
          { type: 'add', newLine: 7, content: `+      PORT: "${cfg.execOsPort}",` },
          { type: 'add', newLine: 8, content: `+      EXECOS_DEFAULT_CWD: "/Users/${cfg.macUsername}/ExecOS"` },
          { type: 'add', newLine: 9, content: '+    }' },
          { type: 'add', newLine: 10, content: '+  }]' },
          { type: 'add', newLine: 11, content: '+};' }
        ]
      }
    ]
  };
}

export function getDynamicWorkspaces(customConfig?: Partial<AppConfig>): WorkbenchWorkspace[] {
  const cfg = { ...getEnvironmentConfig(), ...customConfig };
  const pr1 = getDynamicWorkbenchPR1(cfg);

  return [
    {
      id: 'ws-agentsam',
      name: cfg.appName.toLowerCase().replace(/[^a-z0-9]/g, ''),
      repoName: `${cfg.organization}/${cfg.appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      itemCount: 1,
      description: 'Autonomous execution agent presentation layer, terminal & client workspace',
      statusSummary: {
        working: 0,
        inReview: 1,
        needsAttention: 0
      },
      lastActive: '12m ago',
      pullRequests: [pr1]
    },
    {
      id: 'ws-apex-dynamics',
      name: cfg.clientBrandName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      repoName: `${cfg.organization}/${cfg.clientBrandName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      itemCount: 0,
      description: 'Client production landing page, marketing pitch deck, and brand kit',
      statusSummary: {
        working: 0,
        inReview: 0,
        needsAttention: 0
      },
      lastActive: '1 hour ago',
      pullRequests: []
    },
    {
      id: 'ws-pwa-services',
      name: 'iam-pwa-services',
      repoName: `${cfg.organization}/iam-pwa-services`,
      itemCount: 0,
      description: 'Delegated background sync and push notifications ingest service',
      statusSummary: {
        working: 0,
        inReview: 0,
        needsAttention: 0
      },
      lastActive: 'Yesterday',
      pullRequests: []
    }
  ];
}

export function getDynamicPwaCacheStatus(): PwaCacheStatus {
  return {
    swRegistered: true,
    swStatus: 'active',
    cacheEngine: 'Workbox CacheFirst (Versioned)',
    startupPurgeDisabled: true,
    nonBlockingMount: true,
    shellCached: true,
    lazyMonacoWarmed: false,
    lazyXtermWarmed: true,
    lazyThreeWarmed: false,
    cacheSizeKb: 482
  };
}

export function getDynamicExecOsStatus(customConfig?: Partial<AppConfig>): ExecOsLocalLaneStatus {
  const cfg = { ...getEnvironmentConfig(), ...customConfig };

  return {
    activeLane: 'local_mac',
    isConnected: true,
    latencyMs: 24,
    daemonPort: cfg.execOsPort,
    tunnelUrl: cfg.execOsTunnelUrl,
    workerUrl: cfg.execOsWorkerUrl,
    macUsername: cfg.macUsername,
    defaultCwd: `/Users/${cfg.macUsername}/ExecOS`,
    uptime: '4 days, 18 hrs',
    pm2ProcessName: 'execos',
    pm2Pid: 42188,
    isEcosystemSanitized: false, // User currently has Cursor/shell bleed
    cursorBleedDetected: true,
    totalInheritedEnvVars: 114,
    sanitizedEnvVars: [
      { key: 'NODE_ENV', value: 'production', source: 'sanitized_config', isSafe: true, description: 'Standard Node runtime target' },
      { key: 'PORT', value: String(cfg.execOsPort), source: 'sanitized_config', isSafe: true, description: 'ExecOS HTTP/WebSocket local listener' },
      { key: 'EXECOS_KEY', value: 'sk_live_••••••••89f2', source: 'sanitized_config', isSafe: true, description: 'Device authentication token' },
      { key: 'PTY_AUTH_TOKEN', value: 'pty_tok_••••••••51ac', source: 'sanitized_config', isSafe: true, description: 'Pseudo-terminal session credential' },
      { key: 'AGENTSAM_BRIDGE_KEY', value: 'brg_••••••••74a9', source: 'sanitized_config', isSafe: true, description: 'Local bridge tunnel key' },
      { key: 'EXECOS_DEFAULT_CWD', value: `/Users/${cfg.macUsername}/ExecOS`, source: 'sanitized_config', isSafe: true, description: 'Target working directory for commands' },
      { key: 'EXECOS_MCP_FS_ROOTS', value: `/Users/${cfg.macUsername}`, source: 'sanitized_config', isSafe: true, description: 'Allowed MCP filesystem boundaries' },
      { key: 'SAM_OPERATOR_REPO_PATHS', value: `/Users/${cfg.macUsername}/Projects`, source: 'sanitized_config', isSafe: true, description: 'Repository workspaces scan path' },
      { key: 'WORKER_URL', value: cfg.execOsWorkerUrl, source: 'sanitized_config', isSafe: true, description: 'Cloudflare Worker edge ingress' },
      { key: 'TUNNEL_URL', value: cfg.execOsTunnelUrl, source: 'sanitized_config', isSafe: true, description: 'Encrypted Cloudflare tunnel' },
      { key: 'ALLOWED_TENANTS', value: cfg.activeTenant, source: 'sanitized_config', isSafe: true, description: 'Multi-tenant authorization filter' }
    ],
    bloatedEnvVarsSample: [
      { key: 'VSCODE_PROCESS_TITLE', value: 'extension-host (agent-exec)', source: 'cursor_leak', isSafe: false, description: 'Cursor internal extension title leaked during PM2 restart' },
      { key: 'CURSOR_AGENT', value: '1', source: 'cursor_leak', isSafe: false, description: 'Cursor active agent environment flag' },
      { key: 'CURSOR_CONVERSATION_ID', value: 'c9f8a2-11e0-4a81-9b73', source: 'cursor_leak', isSafe: false, description: 'IDE conversation session token' },
      { key: 'SSH_AUTH_SOCK', value: '/var/run/com.apple.launchd.acoJZVCiQ9/Listeners', source: 'shell_inherited', isSafe: false, description: 'macOS launchd Unix socket for user SSH keys' },
      { key: 'GCP_PROJECT', value: 'cloud-project-primary', source: 'gcp_secret', isSafe: false, description: 'Leaked cloud project identifier' },
      { key: 'ZSH', value: `/Users/${cfg.macUsername}/.oh-my-zsh`, source: 'shell_inherited', isSafe: false, description: 'Interactive terminal path' },
      { key: 'HOMEBREW_PREFIX', value: '/opt/homebrew', source: 'shell_inherited', isSafe: false, description: 'System package manager root' },
      { key: 'USER_EMAIL', value: cfg.developerEmail, source: 'shell_inherited', isSafe: false, description: 'Developer personal email' }
    ],
    sshMode: 'scoped_git_key',
    sshAuthSockPath: '/var/run/com.apple.launchd.acoJZVCiQ9/Listeners',
    fsPermissionsSecure: true,
    allowedTenants: [cfg.activeTenant],
    mcpFsRoots: [`/Users/${cfg.macUsername}`],
    operatorRepoPaths: [`/Users/${cfg.macUsername}/Projects/agentsam`, `/Users/${cfg.macUsername}/Projects/apex-dynamics`],
    recentLocalCommands: [
      {
        id: 'cmd-1',
        command: 'git status -s',
        cwd: `/Users/${cfg.macUsername}/Projects/agentsam`,
        exitCode: 0,
        durationMs: 18,
        timestamp: 'Just now',
        output: ' M src/bootstrap.ts\n M public/sw-agent-cache.js\n?? ecosystem.config.cjs'
      },
      {
        id: 'cmd-2',
        command: 'pm2 status execos',
        cwd: `/Users/${cfg.macUsername}/ExecOS`,
        exitCode: 0,
        durationMs: 34,
        timestamp: '2m ago',
        output: `┌─────┬────────┬─────────────┬─────────┬─────────┬──────────┬────────┬───────────┬───────────┬──────────┬──────────┐\n│ id  │ name   │ mode        │ status  │ restart │ cpu      │ memory │ user      │ watching  │ port     │ uptime   │\n├─────┼────────┼─────────────┼─────────┼─────────┼──────────┼────────┼───────────┼───────────┼──────────┼──────────┤\n│ 0   │ execos │ fork        │ online  │ 1       │ 0.1%     │ 48.2MB │ ${cfg.macUsername} │ disabled  │ ${cfg.execOsPort}     │ 4D 18h   │\n└─────┴────────┴─────────────┴─────────┴─────────┴──────────┴────────┴───────────┴───────────┴──────────┴──────────┘`
      },
      {
        id: 'cmd-3',
        command: 'uname -srm && sw_vers',
        cwd: `/Users/${cfg.macUsername}`,
        exitCode: 0,
        durationMs: 12,
        timestamp: '5m ago',
        output: 'Darwin 24.3.0 arm64\nProductName: macOS\nProductVersion: 15.3.1\nBuildVersion: 24D70'
      }
    ]
  };
}

export const INITIAL_WORKBENCH_PR1 = getDynamicWorkbenchPR1();
export const INITIAL_WORKBENCH_WORKSPACES = getDynamicWorkspaces();
export const INITIAL_PWA_CACHE_STATUS = getDynamicPwaCacheStatus();
export const INITIAL_EXECOS_STATUS = getDynamicExecOsStatus();
