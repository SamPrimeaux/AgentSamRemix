import { PresetMission, MissionStep, MissionReport, BackendType, BACKEND_CONFIGS } from '../types/agentSam';

export const PRESET_MISSIONS: PresetMission[] = [
  {
    id: 'repair-mobile-chat-composer',
    title: 'Repair Mobile Chat Composer (InnerAnimalMedia Engineering Mission)',
    description: 'Autonomous end-to-end repair: Code Mode inspection, multi-file edit, container unit tests, Kitesurf accessibility audit, Browser Run screenshot verification, and Git diff.',
    targetRepo: 'inneranimals/workbench (main)',
    prompt: `MISSION: Fix the mobile chat composer layout and viewport clipping on iOS/Android.
- Inspect existing implementation first with Code Mode (batch search & read).
- Do not create duplicate ownership.
- Modify composer layout with safe-area insets and auto-expanding textarea.
- Run frontend unit tests and verify 18/18 pass.
- Open preview UI via Kitesurf & Browser Run.
- Visually verify repair on mobile viewport (390x844).
- Verify 0 console errors and clean accessibility tree.
- Review Git diff and prepare verified commit.`,
  },
  {
    id: 'identity-authority-audit',
    title: 'Audit Repository for Competing Identity Authorities',
    description: 'Inspect codebase for fragmented session, token, and auth authority implementations. Identify overlap and create consolidation map.',
    targetRepo: 'inneranimals/agentsam-core (v2.4)',
    prompt: `MISSION: Audit this repository for competing identity authorities.
- Do not modify anything.
- Inspect as much of the repository as necessary.
- Use shell/search/filesystem tools freely.
- Maintain a structured execution stream.
- Identify concrete ownership overlap with file evidence.
- Generate an SVG architecture map.
- Produce a proposed consolidation sequence.
- Stop after producing the report.`,
  },
  {
    id: 'cloudflare-worker-d1-migration',
    title: 'Cloudflare Worker to D1 SQL & Container Bridge Migration',
    description: 'Analyze KV/Durable Object storage patterns and generate D1 migration schema with container boundary validation.',
    targetRepo: 'agentsam/worker-runtime',
    prompt: `MISSION: Benchmark storage migration from legacy KV/Durable Objects to Cloudflare D1 with containerized Worker execution.
- Profile latency across cold starts.
- Inspect network boundaries and allowlist dependencies (npm, PyPI).
- Produce benchmark performance comparison and SQL migration script.`,
  },
  {
    id: 'security-network-sandbox-scan',
    title: 'Network Egress & Dependency Policy Verification',
    description: 'Verify package registries (files.pythonhosted.org, npm) and ensure sandbox firewall blocks unauthorized data exfiltration.',
    targetRepo: 'agentsam/secure-sandbox',
    prompt: `MISSION: Audit sandbox network egress policy and package resolution rules.
- Test connection against files.pythonhosted.org and npmjs.org.
- Verify block rules on external arbitrary IPs.
- Compile compliance audit report.`,
  },
];

export function generateStepsForMission(missionId: string, backend: BackendType): { steps: MissionStep[]; report: MissionReport } {
  const isComputer = backend === 'cloudflare_computer';
  const isCloudflare = backend === 'cloudflare';
  const isAntigravity = backend === 'antigravity';
  const isLocal = backend === 'local_pty';

  const envInitTime = BACKEND_CONFIGS[backend].provisionTimeMs;
  const envName = BACKEND_CONFIGS[backend].name;

  if (missionId === 'repair-mobile-chat-composer') {
    const steps: MissionStep[] = [
      {
        id: 'step-comp-0',
        stepNumber: 1,
        timestamp: '00:00.14',
        phase: 'env_init',
        title: 'Preparing Workspace with @cloudflare/computer',
        subAgent: 'Orchestrator',
        thoughtContent: `Initializing @cloudflare/computer workspace. SQLite-backed filesystem mounted instantly. Worker isolate router ready for cheap textual parsing (grep, cat, sed, jq); Linux container placed in standby for lazy test & build execution.`,
        terminal: {
          command: isComputer
            ? 'cloudflare:computer init --sqlite-mount=/workspace --isolate-backend=worker --container-backend=lazy-linux'
            : isAntigravity
            ? 'antigravity env create --preset=managed-sandbox'
            : isCloudflare
            ? 'wrangler containers spawn --plan=basic'
            : 'localpty spawn --cwd=/workspace',
          cwd: '/workspace',
          stdout: `[INFO] @cloudflare/computer runtime initialized in ${envInitTime}ms.
[INFO] Persistent SQLite VFS ready. Backend Router: Worker Isolate + Lazy Container.
[INFO] Model: GLM-5.3 Flash (Default Workhorse via AI Gateway Dynamic Routing)
[INFO] Spend Limit Authority: $5.00/day daily cap enforced.
[OK] Workspace ready for autonomous mission execution.`,
          exitCode: 0,
          durationMs: envInitTime,
          backendLane: isComputer ? 'worker_isolate' : undefined,
        },
        durationMs: envInitTime,
        tokens: { input: 820, output: 95, thinking: 180 },
      },
      {
        id: 'step-comp-1',
        stepNumber: 2,
        timestamp: '00:01.30',
        phase: 'code_mode',
        title: 'Code Mode: Batch Search & Multi-File Repository Inspection',
        subAgent: 'Inspector',
        thoughtContent: `Executing single-turn Code Mode program to discover all chat composer files, examine viewport wrappers, and read css layout definitions simultaneously without 11 round-trips.`,
        codeMode: {
          script: `// Code Mode multi-tool program execution (1 round trip)
const files = await tools.search("ChatComposer", { glob: "src/**/*.{tsx,css}" });
const relevant = files.filter(f => f.path.includes("composer") || f.path.includes("chatLayout"));

const contents = await Promise.all(
  relevant.slice(0, 11).map(f => tools.read(f.path))
);

return {
  inspectedFiles: relevant.map(r => r.path),
  rootCause: "Composer uses fixed bottom-0 without env(safe-area-inset-bottom) & lacks viewport dvh wrapper",
  affectedComponents: ["src/components/ChatComposer.tsx", "src/styles/chatLayout.css", "src/components/ComposerActions.tsx"]
};`,
          composedTools: ['tools.search("ChatComposer")', 'tools.read(11 files in parallel)', 'tools.analyzeAst()'],
          roundTripsSaved: 10,
          resultSummary: 'Found 11 files, extracted layout definitions, isolated clipping bug in fixed bottom offset on mobile iOS/Android in 1 round trip.',
          durationMs: 340,
        },
        durationMs: 340,
        tokens: { input: 1450, output: 320, thinking: 620 },
      },
      {
        id: 'step-comp-2',
        stepNumber: 3,
        timestamp: '00:02.10',
        phase: 'thought',
        title: 'Synthesizing Plan & Architecture Strategy',
        subAgent: 'Orchestrator',
        thoughtContent: `Plan formulated:
1. Modify ChatComposer.tsx to use safe-area padding and dynamic viewport height (100dvh).
2. Update chatLayout.css to support pb-[env(safe-area-inset-bottom)] and overflow-y-auto elastic scrolling.
3. Update ComposerActions.tsx touch targets to meet 44px mobile accessibility standards.
4. Execute unit test suite (npm test) in Linux container.
5. Compile build (vite build) in container.
6. Open preview in Kitesurf for instant accessibility tree audit.
7. Capture mobile viewport screenshot via Browser Run (Chromium).
8. Review Git diff and finalize commit.`,
        durationMs: 280,
        tokens: { input: 1200, output: 290, thinking: 410 },
      },
      {
        id: 'step-comp-3',
        stepNumber: 4,
        timestamp: '00:03.20',
        phase: 'tool_call',
        title: 'Editing src/components/ChatComposer.tsx',
        subAgent: 'Builder',
        thoughtContent: `Applying responsive safe-area fixes and textarea auto-expansion logic in ChatComposer.tsx.`,
        fileDiff: {
          action: 'modify',
          filePath: 'src/components/ChatComposer.tsx',
          linesAnalyzed: 84,
          snippet: `@@ -18,7 +18,11 @@
- <div className="fixed bottom-0 left-0 right-0 p-2 bg-zinc-900">
+ <div className="sticky bottom-0 left-0 right-0 p-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] bg-zinc-900/95 backdrop-blur border-t border-zinc-800 z-30">
-   <textarea className="h-10 w-full resize-none" />
+   <textarea
+     rows={1}
+     className="min-h-[44px] max-h-36 w-full resize-none rounded-xl px-3 py-2 text-sm bg-zinc-800 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
+     placeholder="Message AgentSam..."
+   />`,
        },
        durationMs: 380,
        tokens: { input: 950, output: 210, thinking: 250 },
      },
      {
        id: 'step-comp-4',
        stepNumber: 5,
        timestamp: '00:04.10',
        phase: 'tool_call',
        title: 'Editing src/styles/chatLayout.css & ComposerActions.tsx',
        subAgent: 'Builder',
        thoughtContent: `Adjusting touch target minimum dimensions (44x44px) and elastic scrolling containers in chatLayout.css.`,
        fileDiff: {
          action: 'modify',
          filePath: 'src/styles/chatLayout.css',
          linesAnalyzed: 45,
          snippet: `@@ -4,6 +4,9 @@
 .chat-scroll-container {
-  height: 100vh;
+  height: 100dvh;
+  overscroll-behavior-y: contain;
+  padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
 }`,
        },
        durationMs: 320,
        tokens: { input: 880, output: 180, thinking: 190 },
      },
      {
        id: 'step-comp-5',
        stepNumber: 6,
        timestamp: '00:05.40',
        phase: 'terminal',
        title: 'Container Execution: Running Test Suite (npm test)',
        subAgent: 'Builder',
        thoughtContent: `Reaching Linux container userland lazily for node/jest environment execution. Running chat composer unit and responsive tests.`,
        terminal: {
          command: 'npm test -- --testPathPattern=ChatComposer',
          cwd: '/workspace',
          stdout: ` PASS  src/components/__tests__/ChatComposer.test.tsx
  ChatComposer (Mobile Viewport)
    ✓ renders with safe-area padding calculation (14 ms)
    ✓ auto-expands on multi-line text input (22 ms)
    ✓ maintains touch target >= 44px for action buttons (8 ms)
    ✓ handles mobile keyboard dismiss gracefully (11 ms)
    ✓ handles submit on Enter without shift key (9 ms)

Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total
Snapshots:   0 total
Time:        1.382 s, estimated 2 s
Ran all test suites matching /ChatComposer/i.`,
          exitCode: 0,
          durationMs: 1400,
          backendLane: 'linux_container',
        },
        durationMs: 1400,
        tokens: { input: 1100, output: 240, thinking: 310 },
      },
      {
        id: 'step-comp-6',
        stepNumber: 7,
        timestamp: '00:07.10',
        phase: 'terminal',
        title: 'Container Execution: Production Vite Build',
        subAgent: 'Builder',
        thoughtContent: `Executing vite build in Linux container to confirm zero TypeScript and bundle compilation errors.`,
        terminal: {
          command: 'npm run build',
          cwd: '/workspace',
          stdout: `vite v6.2.0 building for production...
✓ 142 modules transformed.
dist/index.html                   0.82 kB │ gzip:  0.46 kB
dist/assets/index-Dk124.css      18.40 kB │ gzip:  4.12 kB
dist/assets/index-C88a1.js      214.18 kB │ gzip: 68.90 kB
✓ built in 410ms`,
          exitCode: 0,
          durationMs: 580,
          backendLane: 'linux_container',
        },
        durationMs: 580,
        tokens: { input: 620, output: 110, thinking: 140 },
      },
      {
        id: 'step-comp-7',
        stepNumber: 8,
        timestamp: '00:08.20',
        phase: 'browser_verification',
        title: 'Browser Lane: Kitesurf Accessibility & DOM Inspection',
        subAgent: 'BrowserVerifier',
        thoughtContent: `Deploying preview to local ephemeral port and running Kitesurf (Worker-based agent browser) for lightweight, 5x faster accessibility tree inspection.`,
        browserVerification: {
          engine: 'kitesurf_worker',
          url: 'http://localhost:3000/preview/chat',
          viewport: { width: 390, height: 844, device: 'iPhone 15 Pro / Mobile Safari' },
          accessibilityTree: {
            nodesCount: 38,
            ariaSnapshot: `<main role="main">
  <region aria-label="Conversation stream">...</region>
  <form role="form" aria-label="Chat composer form">
    <textbox role="textbox" aria-label="Message AgentSam" aria-multiline="true" />
    <button role="button" aria-label="Attach File" min-height="44px" />
    <button role="button" aria-label="Send Message" min-height="44px" />
  </form>
</main>`,
            contrastPassed: true,
          },
          consoleErrors: [],
          screenshotLabel: 'Kitesurf Fast DOM & ARIA Validation Passed (0 violations)',
          status: 'passed',
        },
        durationMs: 420,
        tokens: { input: 980, output: 190, thinking: 310 },
      },
      {
        id: 'step-comp-8',
        stepNumber: 9,
        timestamp: '00:09.10',
        phase: 'browser_verification',
        title: 'Browser Run: Chromium Mobile Viewport Visual Verification',
        subAgent: 'BrowserVerifier',
        thoughtContent: `Executing Browser Run (Chromium via CDP) to capture pixel-perfect mobile rendering, verify safe-area insets, and inspect browser console logs.`,
        browserVerification: {
          engine: 'browser_run_chromium',
          url: 'http://localhost:3000/preview/chat',
          viewport: { width: 390, height: 844, device: 'iPhone 15 Mobile Viewport' },
          consoleErrors: [],
          screenshotLabel: 'Chromium Pixel-Perfect Render Verified (Zero clipping, proper safe-area-inset-bottom gap)',
          status: 'passed',
        },
        durationMs: 650,
        tokens: { input: 1100, output: 210, thinking: 360 },
      },
      {
        id: 'step-comp-9',
        stepNumber: 10,
        timestamp: '00:10.20',
        phase: 'verification',
        title: 'Git Diff Review & Verified Commit Readiness',
        subAgent: 'Orchestrator',
        thoughtContent: `Reviewing Git diff across all 3 files. Tests (18/18) and visual verification in Kitesurf + Browser Run passed. Ready to commit.`,
        terminal: {
          command: 'git diff --stat',
          cwd: '/workspace',
          stdout: ` src/components/ChatComposer.tsx    | 12 +++++++++---
 src/components/ComposerActions.tsx |  8 +++++---
 src/styles/chatLayout.css          |  7 ++++++-
 3 files changed, 20 insertions(+), 7 deletions(-)

[STATUS] All verification gates passed (Unit Tests 18/18, Vite Build OK, Accessibility OK, Visual Preview OK).
[READY] Commit prepared: "fix(mobile): repair chat composer safe-area insets and touch targets"`,
          exitCode: 0,
          durationMs: 160,
          backendLane: 'worker_isolate',
        },
        durationMs: 160,
        tokens: { input: 740, output: 160, thinking: 220 },
      },
    ];

    const totalInputTokens = steps.reduce((sum, s) => sum + s.tokens.input, 0);
    const totalOutputTokens = steps.reduce((sum, s) => sum + s.tokens.output, 0);
    const totalThinkingTokens = steps.reduce((sum, s) => sum + s.tokens.thinking, 0);
    const totalTokens = totalInputTokens + totalOutputTokens + totalThinkingTokens;

    const modelCostUsd = ((totalInputTokens / 1_000_000) * 0.15) + (((totalOutputTokens + totalThinkingTokens) / 1_000_000) * 0.50);
    const computeCostUsd = 0.0004;

    const report: MissionReport = {
      title: 'Mission Complete: Mobile Chat Composer Repaired & Verified',
      summary: 'Autonomous end-to-end engineering mission completed in 10.2s using GLM-5.3 Flash with @cloudflare/computer dual routing. Repaired safe-area clipping, passed 18/18 tests, validated accessibility via Kitesurf, and visually verified via Browser Run.',
      totalDurationMs: 10200,
      filesInspected: [
        'src/components/ChatComposer.tsx',
        'src/components/ComposerActions.tsx',
        'src/styles/chatLayout.css',
        'src/components/__tests__/ChatComposer.test.tsx'
      ],
      issuesFound: [
        {
          id: 'MOB-01',
          severity: 'high',
          component: 'Mobile Composer Viewport',
          file: 'src/components/ChatComposer.tsx',
          lines: '18-24',
          description: 'Fixed position bottom-0 without env(safe-area-inset-bottom) caused send button to clip behind home indicator on iOS and soft navigation bar on Android.',
          recommendation: 'Use sticky position with dynamic viewport padding pb-[calc(12px+env(safe-area-inset-bottom))]',
        },
        {
          id: 'MOB-02',
          severity: 'medium',
          component: 'Action Button Touch Targets',
          file: 'src/components/ComposerActions.tsx',
          lines: '30-42',
          description: 'Action icons rendered at 32x32px, below the minimum 44px mobile touch target accessibility threshold.',
          recommendation: 'Increase hit area to min-h-[44px] min-w-[44px] with optical centering.',
        },
      ],
      consolidationSequence: [
        { step: 1, title: 'Code Mode Discovery', detail: 'Found all related files in 1 round trip saving 10 model turns.', risk: 'low' },
        { step: 2, title: 'Safe-Area Layout Patch', detail: 'Applied sticky container with dvh viewport units and safe-area padding.', risk: 'low' },
        { step: 3, title: 'Container Test & Build', detail: 'Ran Jest test suite (18/18 pass) and Vite production bundle.', risk: 'low' },
        { step: 4, title: 'Browser Verification', detail: 'Kitesurf accessibility tree audit + Chromium screenshot visual confirmation.', risk: 'low' },
      ],
      architectureSvg: `<svg width="100%" height="220" viewBox="0 0 700 220" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cfGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f38020"/>
      <stop offset="100%" stop-color="#faad3f"/>
    </linearGradient>
    <linearGradient id="laneGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="700" height="220" rx="12" fill="#0b0f19" stroke="#1e293b" stroke-width="1.5"/>
  
  <rect x="20" y="25" width="180" height="60" rx="8" fill="#1e1b4b" stroke="#6366f1" stroke-width="1.5"/>
  <text x="110" y="52" fill="#c7d2fe" font-size="13" font-weight="bold" text-anchor="middle">AgentSam @cloudflare/think</text>
  <text x="110" y="70" fill="#818cf8" font-size="11" text-anchor="middle">GLM-5.3 Flash ($0.15/M)</text>

  <line x1="200" y1="55" x2="260" y2="55" stroke="#6366f1" stroke-width="2" stroke-dasharray="4"/>
  <rect x="260" y="25" width="160" height="60" rx="8" fill="#14532d" stroke="#22c55e" stroke-width="1.5"/>
  <text x="340" y="50" fill="#bbf7d0" font-size="12" font-weight="bold" text-anchor="middle">Code Mode Engine</text>
  <text x="340" y="68" fill="#86efac" font-size="10" text-anchor="middle">10 Round Trips Saved</text>

  <line x1="420" y1="55" x2="480" y2="55" stroke="#22c55e" stroke-width="2"/>
  <rect x="480" y="20" width="200" height="70" rx="8" fill="url(#laneGrad)" stroke="#f38020" stroke-width="1.5"/>
  <text x="580" y="44" fill="#fdba74" font-size="12" font-weight="bold" text-anchor="middle">@cloudflare/computer</text>
  <text x="580" y="62" fill="#94a3b8" font-size="10" text-anchor="middle">Worker Isolate (Text) ⟷ Container (Test)</text>
  <text x="580" y="78" fill="#cbd5e1" font-size="9" text-anchor="middle">SQLite VFS + Git Audit</text>

  <rect x="150" y="125" width="180" height="70" rx="8" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
  <text x="240" y="152" fill="#bae6fd" font-size="12" font-weight="bold" text-anchor="middle">Kitesurf Browser</text>
  <text x="240" y="170" fill="#7dd3fc" font-size="10" text-anchor="middle">Worker Agent Browser (5x Fast)</text>
  <text x="240" y="185" fill="#94a3b8" font-size="9" text-anchor="middle">ARIA & DOM Tree: 100% Pass</text>

  <line x1="330" y1="160" x2="390" y2="160" stroke="#38bdf8" stroke-width="2"/>

  <rect x="390" y="125" width="180" height="70" rx="8" fill="#1e293b" stroke="#ec4899" stroke-width="1.5"/>
  <text x="480" y="152" fill="#fbcfe8" font-size="12" font-weight="bold" text-anchor="middle">Browser Run Chromium</text>
  <text x="480" y="170" fill="#f472b6" font-size="10" text-anchor="middle">Mobile Viewport (390x844)</text>
  <text x="480" y="185" fill="#94a3b8" font-size="9" text-anchor="middle">0 Console Errors / Pixel Verified</text>
</svg>`,
      tokenSummary: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        thinkingTokens: totalThinkingTokens,
        totalTokens,
        modelCostUsd,
        computeCostUsd,
        totalCostUsd: modelCostUsd + computeCostUsd,
      },
    };

    return { steps, report };
  }

  // Default / Audit missions
  const steps: MissionStep[] = [
    {
      id: 'step-0',
      stepNumber: 1,
      timestamp: '00:01.20',
      phase: 'env_init',
      title: 'Spinning up new environment',
      thoughtContent: `Provisioning target execution sandbox (${envName}). Checking filesystem mounts, process isolation namespace, and network firewall policies. Setting up environment variables and ephemeral rootfs.`,
      terminal: {
        command: isComputer
          ? 'cloudflare:computer spawn --sqlite-fs=/workspace --router=dual-isolate-container'
          : isCloudflare
          ? 'wrangler containers spawn --plan=basic --cpu=0.25 --memory=1024MB --disk=4GB --name=agentsam-sandbox-lane'
          : isAntigravity
          ? 'antigravity env create --preset=managed-sandbox --arch=x86_64 --firewall=strict-allowlist'
          : isLocal
          ? 'localpty spawn --pty-sandbox --cwd=/workspace'
          : 'gcloud compute instances create agentsam-runner --zone=us-central1-a --machine-type=e2-standard-2',
        cwd: '/system/orchestrator',
        stdout: `[INFO] Container runtime initialized in ${envInitTime}ms.
[INFO] CPU Allocation: ${BACKEND_CONFIGS[backend].cpu} | RAM: ${BACKEND_CONFIGS[backend].ram}
[INFO] Network Policy: ${BACKEND_CONFIGS[backend].networkPolicy}
[INFO] Persistent workspace mounted at /workspace
[OK] Sandbox ready for autonomous execution loop.`,
        exitCode: 0,
        durationMs: envInitTime,
        backendLane: isComputer ? 'worker_isolate' : undefined,
      },
      durationMs: envInitTime,
      tokens: { input: 1240, output: 140, thinking: 310 },
    },
    {
      id: 'step-1',
      stepNumber: 2,
      timestamp: '00:03.45',
      phase: 'thought',
      title: 'Formulating Repository Exploration Strategy',
      thoughtContent: `The objective is to audit for competing identity authorities without modifying files.
I will first execute a broad structural inventory:
1. Scan for authentication middlewares, JWT validators, and OAuth token handlers.
2. Locate stateful session stores (Redis, Cloudflare KV, SQLite, Firebase Auth).
3. Search for conflicting user context resolution in API route interceptors.
4. Record every conflicting implementation with exact file paths and line ranges.`,
      durationMs: 450,
      tokens: { input: 2450, output: 380, thinking: 1120 },
    },
    {
      id: 'step-2',
      stepNumber: 3,
      timestamp: '00:04.90',
      phase: 'terminal',
      title: 'Inventorying Project Tree & Auth Keywords',
      thoughtContent: `Running ripgrep across the repository to identify files handling auth tokens, session headers, and user credential validation.`,
      terminal: {
        command: 'rg -n --ignore-case "createSession|verifyToken|jwt\\.verify|getAuthUser|authMiddleware|supabase\\.auth|firebaseAdmin" src/',
        cwd: '/workspace',
        stdout: `src/middleware/authInterceptor.ts:14:export async function authMiddleware(req: Request) {
src/middleware/authInterceptor.ts:28:  const decoded = await verifyToken(token);
src/auth/sessionManager.ts:32:export async function createSession(userId: string, tenantId: string) {
src/auth/jwtHandler.ts:19:export function verifyToken(rawJwt: string) {
src/lib/oauthGateway.ts:44:export async function handleOAuthCallback(code: string) {
src/context/userPrincipal.ts:12:export function getAuthUser(headers: Headers) {`,
        exitCode: 0,
        durationMs: 310,
        backendLane: isComputer ? 'worker_isolate' : undefined,
      },
      durationMs: 310,
      tokens: { input: 1890, output: 210, thinking: 480 },
    },
    {
      id: 'step-3',
      stepNumber: 4,
      timestamp: '00:06.15',
      phase: 'tool_call',
      title: 'Auditing src/middleware/authInterceptor.ts',
      thoughtContent: `Inspecting token extraction logic. Found fallback branching: checks 'Authorization: Bearer' header, falls back to 'x-agentsam-session' cookie, and additionally attempts Firebase Admin ID verification if JWT fails.`,
      fileDiff: {
        action: 'read',
        filePath: 'src/middleware/authInterceptor.ts',
        linesAnalyzed: 95,
        snippet: `// Line 22-38: Dual token evaluation hazard
const bearer = req.headers.get("Authorization")?.replace("Bearer ", "");
if (bearer) {
  try {
    return await verifyJwtToken(bearer); // Authority A: Local HMAC
  } catch (err) {
    return await firebaseAdmin.auth().verifyIdToken(bearer); // Authority B: Firebase
  }
}
const cookieSession = getCookie(req, "agentsam_sess");
if (cookieSession) {
  return await kvSessionStore.get(cookieSession); // Authority C: KV Store
}`,
      },
      durationMs: 520,
      tokens: { input: 3200, output: 490, thinking: 890 },
    },
    {
      id: 'step-4',
      stepNumber: 5,
      timestamp: '00:08.00',
      phase: 'network_egress',
      title: 'Testing Allowlist Resolution on Package Registries',
      thoughtContent: `Testing network egress rules against allowlisted registries and confirming arbitrary external endpoints are rejected.`,
      network: {
        host: 'registry.npmjs.org',
        endpoint: '/@google/genai',
        method: 'GET',
        status: 200,
        bytes: 42190,
        reason: 'Allowlisted registry package metadata',
        allowed: true,
      },
      durationMs: 220,
      tokens: { input: 890, output: 95, thinking: 180 },
    },
    {
      id: 'step-5',
      stepNumber: 6,
      timestamp: '00:09.40',
      phase: 'tool_call',
      title: 'Auditing src/lib/oauthGateway.ts',
      thoughtContent: `Analyzing OAuth callback flow. OAuth handler mints its own custom cookie and does not register session identifier in the KV session store.`,
      fileDiff: {
        action: 'audit',
        filePath: 'src/lib/oauthGateway.ts',
        linesAnalyzed: 140,
        snippet: `// Line 55-72: Disconnected Session State
const tokenResponse = await exchangeCodeForToken(code);
const user = await fetchUserProfile(tokenResponse.access_token);
// Notice: sets cookie directly without registering with sessionManager
return new Response(JSON.stringify({ user }), {
  headers: { "Set-Cookie": \`oauth_token=\${tokenResponse.access_token}; HttpOnly; Secure\` }
});`,
      },
      durationMs: 610,
      tokens: { input: 3850, output: 540, thinking: 1050 },
    },
    {
      id: 'step-6',
      stepNumber: 7,
      timestamp: '00:11.80',
      phase: 'verification',
      title: 'Synthesizing Architecture & Generating Audit Artifacts',
      thoughtContent: `All 3 conflicting identity authorities cataloged:
1. Local HMAC JWT validator (src/auth/jwtHandler.ts)
2. Cloudflare KV Session Store (src/auth/sessionManager.ts)
3. Direct OAuth Cookie Injector (src/lib/oauthGateway.ts)
Synthesizing migration sequencing and SVG architecture diagram.`,
      durationMs: 820,
      tokens: { input: 4100, output: 1200, thinking: 2100 },
    },
  ];

  const totalInputTokens = steps.reduce((sum, s) => sum + s.tokens.input, 0);
  const totalOutputTokens = steps.reduce((sum, s) => sum + s.tokens.output, 0);
  const totalThinkingTokens = steps.reduce((sum, s) => sum + s.tokens.thinking, 0);
  const totalTokens = totalInputTokens + totalOutputTokens + totalThinkingTokens;

  const modelCostUsd = ((totalInputTokens / 1_000_000) * 0.15) + (((totalOutputTokens + totalThinkingTokens) / 1_000_000) * 0.50);
  const computeCostUsd = isAntigravity ? 0.0 : ((steps.reduce((sum, s) => sum + s.durationMs, 0) / 3600000) * BACKEND_CONFIGS[backend].computeCostPerHour);

  const architectureSvg = `<svg width="100%" height="220" viewBox="0 0 700 220" xmlns="http://www.w3.org/2000/svg">
  <rect width="700" height="220" rx="12" fill="#0d1117" stroke="#30363d" stroke-width="1.5"/>
  <rect x="20" y="75" width="130" height="70" rx="8" fill="#161b22" stroke="#58a6ff" stroke-width="1.5"/>
  <text x="85" y="105" fill="#f0f6fc" font-size="12" font-weight="bold" text-anchor="middle">Client App</text>
  <text x="85" y="125" fill="#8b949e" font-size="10" text-anchor="middle">Mobile / Web</text>
  <line x1="150" y1="110" x2="200" y2="110" stroke="#58a6ff" stroke-width="2" stroke-dasharray="4"/>
  <rect x="200" y="30" width="180" height="160" rx="10" fill="#161b22" stroke="#f85149" stroke-width="1.5"/>
  <text x="290" y="55" fill="#ff7b72" font-size="12" font-weight="bold" text-anchor="middle">Current Auth Split</text>
  <rect x="215" y="70" width="150" height="30" rx="4" fill="#21262d" stroke="#30363d"/>
  <text x="290" y="90" fill="#c9d1d9" font-size="10" text-anchor="middle">1. Local HMAC JWT</text>
  <rect x="215" y="110" width="150" height="30" rx="4" fill="#21262d" stroke="#30363d"/>
  <text x="290" y="130" fill="#c9d1d9" font-size="10" text-anchor="middle">2. Cloudflare KV Store</text>
  <rect x="215" y="150" width="150" height="30" rx="4" fill="#21262d" stroke="#30363d"/>
  <text x="290" y="170" fill="#c9d1d9" font-size="10" text-anchor="middle">3. OAuth Cookie</text>
  <line x1="380" y1="110" x2="440" y2="110" stroke="#f85149" stroke-width="2"/>
  <rect x="440" y="50" width="230" height="120" rx="10" fill="#161b22" stroke="#238636" stroke-width="1.5"/>
  <text x="555" y="75" fill="#3fb950" font-size="12" font-weight="bold" text-anchor="middle">Consolidated Authority (Target)</text>
  <text x="555" y="95" fill="#8b949e" font-size="10" text-anchor="middle">Unified Session Manager + D1</text>
  <rect x="460" y="110" width="190" height="40" rx="6" fill="#238636" fill-opacity="0.15" stroke="#2ea043"/>
  <text x="555" y="135" fill="#7ee787" font-size="11" font-weight="bold" text-anchor="middle">Canonical AuthPrincipal</text>
</svg>`;

  const report: MissionReport = {
    title: 'Identity Authority Fragmentation Audit Report',
    summary: 'Identified 3 competing identity authority implementations creating potential session desynchronization and security perimeter drift across API routes.',
    totalDurationMs: steps.reduce((sum, s) => sum + s.durationMs, 0),
    filesInspected: [
      'src/middleware/authInterceptor.ts',
      'src/auth/sessionManager.ts',
      'src/auth/jwtHandler.ts',
      'src/lib/oauthGateway.ts',
      'src/context/userPrincipal.ts',
    ],
    issuesFound: [
      {
        id: 'ISS-01',
        severity: 'critical',
        component: 'Auth Interceptor',
        file: 'src/middleware/authInterceptor.ts',
        lines: '22-38',
        description: 'Race condition between local KV session tokens and Firebase Admin ID tokens. Inconsistent user principal structure returned to downstream handlers.',
        recommendation: 'Implement an abstract AuthPrincipal adapter that maps all token payloads into a strictly typed Principal context.',
      },
      {
        id: 'ISS-02',
        severity: 'high',
        component: 'OAuth Gateway',
        file: 'src/lib/oauthGateway.ts',
        lines: '55-72',
        description: 'Refresh token stored in uncoordinated HTTP-only cookie without matching record in central revocation table.',
        recommendation: 'Route OAuth completion through Unified SessionManager to register session ID and device fingerprint.',
      },
      {
        id: 'ISS-03',
        severity: 'medium',
        component: 'JWT Handler',
        file: 'src/auth/jwtHandler.ts',
        lines: '28-45',
        description: 'Separate HMAC secret configured in environment variables, out of sync with edge worker validation keys.',
        recommendation: 'Adopt asymmetric Ed25519 or RS256 JWKS endpoint served by the central identity authority.',
      },
    ],
    consolidationSequence: [
      {
        step: 1,
        title: 'Define Canonical AuthPrincipal Type & Middleware Bridge',
        detail: 'Create a shared Principal interface in src/types/auth.ts and wrap existing handlers with an adapter layer to prevent breaking API changes.',
        risk: 'low',
      },
      {
        step: 2,
        title: 'Centralize Session State in Cloudflare D1 / Managed DB',
        detail: 'Deprecate in-memory KV maps in sessionManager.ts in favor of persistent, queryable session table with instant revocation capabilities.',
        risk: 'medium',
      },
      {
        step: 3,
        title: 'Unify OAuth & Firebase Handlers into Gateway Pipeline',
        detail: 'Ensure OAuth callbacks and Firebase token verifications emit standard session cookies signed by the primary authority key.',
        risk: 'medium',
      },
      {
        step: 4,
        title: 'Deprecate & Remove Legacy JWT Endpoints',
        detail: 'Decommission ad-hoc JWT verify functions after all client SDKs upgrade to the new session validation protocol.',
        risk: 'low',
      },
    ],
    architectureSvg,
    tokenSummary: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      thinkingTokens: totalThinkingTokens,
      totalTokens,
      modelCostUsd,
      computeCostUsd,
      totalCostUsd: modelCostUsd + computeCostUsd,
    },
  };

  return { steps, report };
}
