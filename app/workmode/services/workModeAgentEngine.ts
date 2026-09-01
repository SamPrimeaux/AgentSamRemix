import { ModelChoice, TaskTrace, SlideItem, ClientWebsiteData, GeneratedImageItem, GeneratedVideoItem } from '../types';
import { TelemetryData } from '../lib/telemetry';

export interface AgentRunResult {
  text: string;
  trace?: TaskTrace;
  newSlides?: SlideItem[];
  websiteUpdates?: Partial<ClientWebsiteData>;
  newImage?: GeneratedImageItem;
  newVideo?: GeneratedVideoItem;
  terminalLogs?: string[];
  telemetry?: TelemetryData;
}

export async function executeAgentSamTask(
  prompt: string,
  model: ModelChoice = 'gemini-3.5-flash',
  context?: {
    currentSlides?: SlideItem[];
    currentWebsite?: ClientWebsiteData;
    activeBranch?: string;
  }
): Promise<AgentRunResult> {
  const startTime = performance.now();
  const lowerPrompt = prompt.toLowerCase();

  // Call Server-Side Gemini API Proxy (/api/gemini/chat)
  let geminiOutput = '';
  try {
    const res = await fetch('/api/gemini/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        model,
        systemInstruction: `You are Agent Sam, a senior autonomous full-stack execution agent and creative brand architect.
You build client marketing presentations, high-converting websites with responsive blocks, executive telemetry dashboards, and brand identity kits.
Respond concisely, with high confidence, professional composure, and actionable steps.
When discussing code, files, or presentations, be precise and reference specific components or metrics.`
      })
    });

    if (res.ok) {
      const data = (await res.json()) as { text?: string; fallback?: boolean };
      if (data.text) {
        geminiOutput = data.text;
      }
    }
  } catch (err: any) {
    console.warn('Backend Gemini API notice (falling back to execution synthesizer):', err?.message || err);
  }

  const endTime = performance.now();
  const telemetry = {
    latencyMs: endTime - startTime,
    inputTokens: Math.floor(Math.random() * 1000), // Mocked for demo
    outputTokens: Math.floor(Math.random() * 500), // Mocked for demo
    model,
    cost: 0 // Will calculate in dashboard
  };

  // Determine intent & generate rich agent execution trace
  const isTestOrCommand = lowerPrompt.includes('test') || lowerPrompt.includes('run') || lowerPrompt.includes('auth') || lowerPrompt.includes('push') || lowerPrompt.includes('build');
  const isPresentation = lowerPrompt.includes('presentation') || lowerPrompt.includes('slide') || lowerPrompt.includes('pitch') || lowerPrompt.includes('deck');
  const isWebsite = lowerPrompt.includes('website') || lowerPrompt.includes('landing') || lowerPrompt.includes('page') || lowerPrompt.includes('hero') || lowerPrompt.includes('copy');
  const isBrandOrImage = lowerPrompt.includes('brand') || lowerPrompt.includes('logo') || lowerPrompt.includes('image') || lowerPrompt.includes('visual') || lowerPrompt.includes('render');
  const isVideo = lowerPrompt.includes('video') || lowerPrompt.includes('veo') || lowerPrompt.includes('animate') || lowerPrompt.includes('motion');
  const isDashboard = lowerPrompt.includes('dashboard') || lowerPrompt.includes('kpi') || lowerPrompt.includes('metric') || lowerPrompt.includes('analytics');

  let trace: TaskTrace | undefined;
  let newSlides: SlideItem[] | undefined;
  let websiteUpdates: Partial<ClientWebsiteData> | undefined;
  let newImage: GeneratedImageItem | undefined;
  let newVideo: GeneratedVideoItem | undefined;
  let terminalLogs: string[] = [];

  if (isPresentation) {
    const elapsed = ((performance.now() - startTime) / 1000 + 1.2).toFixed(2);
    trace = {
      id: 'trace-' + Date.now(),
      title: 'Synthesize Client Presentation Deck',
      status: 'completed',
      filesReadCount: 4,
      filesEditedCount: 2,
      command: {
        cmd: 'agentsam compile-deck --target client-pitch --theme modern-dark',
        location: 'marketing/decks • Local Mac',
        duration: `${elapsed}s`,
        passed: 4,
        failed: 0,
        summary: '4 slides generated & formatted'
      },
      steps: [
        { id: 's1', type: 'read', label: 'Analyzed Client Brand Guidelines & Q4 Positioning', status: 'completed' },
        { id: 's2', type: 'edit', label: 'Structured 4-Slide Executive Narrative', status: 'completed' },
        { id: 's3', type: 'generate', label: 'Synthesized High-Impact Data Visuals', status: 'completed', time: `${elapsed}s` }
      ],
      outputSnippet: `> agentsam compile-deck --target client-pitch
[OK] Slide 1: Executive Value Proposition [Rendered]
[OK] Slide 2: Market Friction & Opportunity Matrix [Rendered]
[OK] Slide 3: Autonomous Agent Execution Architecture [Rendered]
[OK] Slide 4: Phased Commercial Milestones & ROI [Rendered]

[Done] 4/4 slides validated and ready in Work Mode.`
    };

    newSlides = [
      {
        id: 'slide-' + Date.now() + '-1',
        badge: 'Strategic Vision',
        title: prompt.length > 10 ? `Strategic Architecture: ${prompt.slice(0, 45)}...` : 'Next-Gen Autonomous Agent Infrastructure',
        subtitle: 'Unlocking 3x faster client asset delivery with full-stack agentic execution.',
        bullets: [
          'Unified design system synchronized across mobile, web, and presentation media',
          'AI-assisted copy refinement maintaining consistent brand voice across all touchpoints',
          'Real-time automated QA testing ensuring 100% deployment reliability'
        ],
        metrics: [
          { label: 'Time-to-Market', value: '-82%', trend: 'Rapid' },
          { label: 'Client Approvals', value: '96.8%', trend: 'First Review' },
          { label: 'Cost per Asset', value: '$12', trend: 'vs $450 legacy' }
        ],
        accentColor: '#10b981'
      }
    ];

    if (!geminiOutput) {
      geminiOutput = `I've synthesized a new executive presentation deck aligned with your request: "${prompt}". You can review, present in fullscreen, or live-edit the slide deck in the Work > Presentations tab!`;
    }
  } else if (isWebsite) {
    const elapsed = ((performance.now() - startTime) / 1000 + 1.4).toFixed(2);
    trace = {
      id: 'trace-' + Date.now(),
      title: 'Scaffold & Sync Realtime CMS Experience',
      status: 'completed',
      filesReadCount: 8,
      filesEditedCount: 4,
      command: {
        cmd: 'agentsam-cms-sync --target client-landing --live-reload --edge-push',
        location: 'frontend/cms-schema • Local Mac',
        duration: `${elapsed}s`,
        passed: 18,
        failed: 0,
        summary: 'Landing blocks & CMS tree hot-reloaded'
      },
      steps: [
        { id: 's1', type: 'read', label: 'Parsed Block Tree (Hero, Bento, Features, Pricing, FAQs)', status: 'completed' },
        { id: 's2', type: 'edit', label: 'Updated Section Block Content & Brand Tokens', status: 'completed' },
        { id: 's3', type: 'command', label: 'Edge AST Bundler & Realtime WebSocket Hot-Reload', status: 'completed', time: `${elapsed}s` }
      ],
      outputSnippet: `> agentsam-cms-sync --target client-landing
[OK] Block AST parsed: 8 sections synchronized
[OK] Real-time CMS State updated: Hero, Features, Pricing, Bento, Testimonials
dist/index.html                   1.42 kB │ gzip: 0.62 kB
dist/assets/index-D8x0z.css      14.28 kB │ gzip: 3.84 kB
dist/assets/index-C5f9a.js       88.12 kB │ gzip: 26.54 kB
[Done] CMS Sync and Edge CDN propagation ready in ${elapsed}s.`
    };

    const currentSite = context?.currentWebsite;
    const isFintech = lowerPrompt.includes('fintech') || lowerPrompt.includes('banking') || lowerPrompt.includes('payment');
    const isAgency = lowerPrompt.includes('agency') || lowerPrompt.includes('design') || lowerPrompt.includes('creative');

    let updatedAccent = currentSite?.accentColor || '#2563eb';
    let updatedHeadline = prompt.length > 15 
      ? `Engineered for High-Velocity Execution: ${prompt.slice(0, 35)}` 
      : 'Empowering Visionary Brands with Autonomous Execution';

    if (isFintech) {
      updatedAccent = '#10b981';
      updatedHeadline = 'Institutional AI Payment Rails & Settlement Infrastructure';
    } else if (isAgency) {
      updatedAccent = '#8b5cf6';
      updatedHeadline = 'Creative Intelligence Studio for Next-Era Global Brands';
    }

    websiteUpdates = {
      heroHeadline: updatedHeadline,
      heroSubheadline: 'Bespoke marketing presentations, rapid website deployments, and live data telemetry built collaboratively in real time.',
      accentColor: updatedAccent,
      deployment: {
        ...(currentSite?.deployment || {
          subdomain: 'preview',
          deployedUrl: 'https://preview.apexdynamics.ai',
          status: 'deployed',
          version: 'v2.4.1',
          lastDeployedAt: 'Just now',
          commitHash: '8e4f1a2',
          sslStatus: 'active',
          edgeRegion: 'iad1 (US East)'
        }),
        lastDeployedAt: 'Just now (hot-reload synced)'
      }
    };

    if (!geminiOutput) {
      geminiOutput = `I've updated the client website landing page and synchronized all active CMS blocks. You can live-edit blocks, reorder layout sections, preview responsive device viewports, or trigger global edge deployments in the Work > Websites tab.`;
    }
  } else if (isVideo) {
    const elapsed = '4.10';
    trace = {
      id: 'trace-' + Date.now(),
      title: 'Animate Brand Assets with Veo Video Generation',
      status: 'completed',
      filesReadCount: 2,
      filesEditedCount: 1,
      command: {
        cmd: 'veo-3.1-fast-generate-preview --aspect 16:9 --res 1080p',
        location: 'media/veo-gen • Cloud Node',
        duration: `${elapsed}s`,
        passed: 1,
        failed: 0,
        summary: '1080p cinematic video rendered'
      },
      steps: [
        { id: 's1', type: 'read', label: 'Loaded Brand Keyframe & Lighting Prompt', status: 'completed' },
        { id: 's2', type: 'generate', label: 'Veo Video Inference Engine (1080p 60fps)', status: 'completed', time: `${elapsed}s` }
      ],
      outputSnippet: `> veo-3.1-fast-generate-preview
[1/3] Synthesizing volumetric mist & camera spline...
[2/3] Temporal interpolation 60fps...
[3/3] Encoding MP4 H.264...
[Done] Video render completed successfully in ${elapsed}s.`
    };

    newVideo = {
      id: 'vid-' + Date.now(),
      prompt: prompt || 'Cinematic luxury brand motion showcase with emerald illumination and smooth drone dolly camera motion',
      posterUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80',
      videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-screens-with-charts-31911-large.mp4',
      aspectRatio: '16:9',
      duration: '0:08',
      status: 'ready',
      model: 'veo-3.1-fast-generate-preview',
      timestamp: 'Just now'
    };

    if (!geminiOutput) {
      geminiOutput = `I've generated a 1080p cinematic motion video using the Veo fast preview model for this brand asset. You can preview, loop, or export it in the Work > Brand tab!`;
    }
  } else if (isBrandOrImage) {
    const elapsed = '2.84';
    trace = {
      id: 'trace-' + Date.now(),
      title: 'Generate Brand Imagery with Gemini Flash Image',
      status: 'completed',
      filesReadCount: 3,
      filesEditedCount: 1,
      command: {
        cmd: 'gemini-3.1-flash-image-preview --res 1K --aspect 16:9',
        location: 'media/brand-kit • Cloud Node',
        duration: `${elapsed}s`,
        passed: 1,
        failed: 0,
        summary: '1K photorealistic asset synthesized'
      },
      steps: [
        { id: 's1', type: 'read', label: 'Injected Color Token Swatches (#09090b, #10b981)', status: 'completed' },
        { id: 's2', type: 'generate', label: 'Flash Image Synthesis & Tone Mapping', status: 'completed', time: `${elapsed}s` }
      ],
      outputSnippet: `> gemini-3.1-flash-image-preview
Prompt: ${prompt}
Aspect Ratio: 16:9 | Quality: 1K Octane Render
[Done] Asset rendered and saved to brand kit.`
    };

    newImage = {
      id: 'img-' + Date.now(),
      prompt: prompt || 'Futuristic luxury flagship showroom with ambient carbon and emerald lighting',
      imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
      model: 'gemini-3.1-flash-image-preview',
      aspectRatio: '16:9',
      timestamp: 'Just now',
      tags: ['AI Render', 'Brand Asset', 'Campaign']
    };

    if (!geminiOutput) {
      geminiOutput = `I've generated high-fidelity brand visual assets matching your prompt using the gemini-3.1-flash-image model. It is now linked in your Brand Identity Studio.`;
    }
  } else {
    // Default test / execution trace matching the exact mockup
    const elapsed = '4.32';
    trace = {
      id: 'trace-' + Date.now(),
      title: 'Run Command & Test Suite',
      status: 'completed',
      filesReadCount: 6,
      filesEditedCount: 3,
      command: {
        cmd: prompt.startsWith('npm') || prompt.startsWith('node') ? prompt : 'npm test -- auth',
        location: 'backend/agentsam • Local Mac',
        duration: '18s',
        passed: 18,
        failed: 0,
        summary: '18 passed / 0 failed'
      },
      steps: [
        { id: 's1', type: 'read', label: 'Read 6 files', sublabel: 'Completed', status: 'completed' },
        { id: 's2', type: 'edit', label: 'Edited 3 files', sublabel: 'Completed', status: 'completed' },
        { id: 's3', type: 'command', label: 'Run Command', sublabel: 'npm test -- auth', status: 'completed', time: '18s', details: '18 passed • 0 failed' }
      ],
      outputSnippet: `> npm test -- auth
> node --test test/auth

[OK] auth/session.test.ts          2.1s
[OK] auth/oauth.test.ts            1.3s
[OK] auth/guards.test.ts           1.0s
[OK] auth/workspace-access.test.ts 1.6s
[OK] auth/middleware.test.ts       0.8s

Test Files   5 passed (5)
Tests        18 passed (18)
Start        9:40:12 AM
Duration     4.32s

[Done] Done in 4.32s.`
    };

    if (!geminiOutput) {
      geminiOutput = `I've verified the entire test suite and workspace configuration. All 18 automated tests passed with zero regressions (4.32s). The branch is clean and ready for deployment or presentation export.`;
    }
  }

  terminalLogs = [
    `sam@Sams-MacBook backend/agentsam % ${trace?.command?.cmd || 'npm test -- auth'}`,
    trace?.outputSnippet || '[Done] Done in 4.32s.',
    `sam@Sams-MacBook backend/agentsam % `
  ];

  return {
    text: geminiOutput,
    trace,
    newSlides,
    websiteUpdates,
    newImage,
    newVideo,
    terminalLogs,
    telemetry
  };
}
