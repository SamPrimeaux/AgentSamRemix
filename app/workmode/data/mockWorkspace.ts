import { 
  PresentationDeck, 
  ClientWebsiteData, 
  DashboardMetric, 
  BrandKitData, 
  CollaboratorAgent,
  ChatMessageItem,
  AppConfig
} from '../types';
import { TEMPLATE_SAAS_AI } from './mockWebsiteTemplates';
import { getEnvironmentConfig } from '../context/WorkModeConfigContext';

export function getDynamicCollaborators(customConfig?: Partial<AppConfig>): CollaboratorAgent[] {
  const cfg = { ...getEnvironmentConfig(), ...customConfig };
  return [
    {
      id: 'agent-sam',
      name: cfg.agentName,
      role: cfg.agentRole,
      initials: cfg.agentInitials,
      color: 'bg-emerald-600 dark:bg-emerald-500 text-white',
      status: 'executing',
      currentAction: 'Running live test assertions & asset synthesis'
    },
    {
      id: 'agent-maya',
      name: 'Maya V.',
      role: 'Creative Director & Brand Strategist',
      initials: 'MV',
      color: 'bg-violet-600 dark:bg-violet-500 text-white',
      status: 'active',
      currentAction: 'Generating key visual moodboard & color palettes'
    },
    {
      id: 'agent-alex',
      name: 'Alex Rivera',
      role: 'Presentation & UI Systems Architect',
      initials: 'AR',
      color: 'bg-blue-600 dark:bg-blue-500 text-white',
      status: 'active',
      currentAction: 'Finalizing interactive pitch deck slides'
    },
    {
      id: 'agent-david',
      name: 'David Chen',
      role: 'Growth & Marketing Analytics Specialist',
      initials: 'DC',
      color: 'bg-amber-600 dark:bg-amber-500 text-white',
      status: 'idle',
      currentAction: 'Monitoring live ROAS & funnel conversion'
    }
  ];
}

export function getDynamicPresentation(customConfig?: Partial<AppConfig>): PresentationDeck {
  const cfg = { ...getEnvironmentConfig(), ...customConfig };
  return {
    id: `deck-${cfg.clientBrandName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-q4`,
    title: `${cfg.clientBrandName} — Enterprise Brand & Launch Strategy`,
    client: `${cfg.clientBrandName} Global Technologies`,
    version: 'v2.4 (Live Executed)',
    lastUpdated: 'Just now',
    slides: [
      {
        id: 'slide-1',
        badge: 'Executive Pitch',
        title: `Accelerating AI Transformation in Enterprise Ops`,
        subtitle: `A bespoke go-to-market architecture designed to triple enterprise pipeline in 90 days.`,
        bullets: [
          'Proprietary agentic automation stack reducing manual workflow overhead by 78%',
          'Seamless deployment with zero-disruption legacy enterprise integrations',
          'Demonstrated 4.2x ROI across pilot Fortune 500 manufacturing deployments'
        ],
        metrics: [
          { label: 'Pilot ARR Uplift', value: '+$4.8M', trend: '+42% QoQ' },
          { label: 'Cycle Time Reduction', value: '-68%', trend: 'Efficiency' },
          { label: 'CSAT Rating', value: '98.4%', trend: 'World-Class' }
        ],
        accentColor: '#10b981'
      },
      {
        id: 'slide-2',
        badge: 'The Problem & Market Void',
        title: 'Fragmented MarTech & Disconnected Brand Assets',
        subtitle: 'Enterprises lose up to 34% of conversion velocity due to asynchronous marketing bottlenecks.',
        bullets: [
          'Marketing assets remain siloed across legacy design tools and unverified databases',
          'Product updates take 3-5 weeks to reflect in public customer-facing web collateral',
          'Lack of real-time multi-agent execution results in brand dilution across regional branches'
        ],
        quote: {
          text: 'The bottleneck in modern scaling is no longer data acquisition—it is the speed at which ideas convert into deployed brand artifacts.',
          author: `Chief Growth Officer, ${cfg.clientBrandName}`
        },
        accentColor: '#3b82f6'
      },
      {
        id: 'slide-3',
        badge: 'Solution Architecture',
        title: `${cfg.appName} Execution Engine: Autonomous Brand Delivery`,
        subtitle: 'From natural language strategy prompts to compiled client presentation decks, production websites, and live analytics.',
        bullets: [
          'Real-time execution traces with sandboxed unit testing & lint validation',
          'Automated 4K brand image synthesis & Veo cinematic video generation',
          'Instant multi-channel synchronization across mobile, desktop, and client portals'
        ],
        metrics: [
          { label: 'Asset Render Time', value: '4.32s', trend: 'Instant' },
          { label: 'Test Pass Rate', value: '100%', trend: '18/18 Passed' },
          { label: 'Global Latency', value: '<45ms', trend: 'Edge CDN' }
        ],
        accentColor: '#8b5cf6'
      },
      {
        id: 'slide-4',
        badge: 'Commercial Roadmap',
        title: 'Phased Rollout & Revenue Acceleration Milestones',
        subtitle: 'Strategic execution timeline targeting $12.5M incremental annualized revenue.',
        bullets: [
          'Month 1: Brand System Finalization & Core Landing Experience Launch',
          'Month 2: Multi-Agent Marketing Campaign Automation & Ad Synthesizer',
          'Month 3: Operations Performance Dashboard & Real-Time Executive Reporting'
        ],
        metrics: [
          { label: 'Target ACV', value: '$140k', trend: 'Tier-1 Target' },
          { label: 'Net Retention', value: '138%', trend: 'Projected' }
        ],
        callToAction: 'Approve Go-Live Execution',
        accentColor: '#f59e0b'
      }
    ]
  };
}

export function getDynamicClientWebsite(customConfig?: Partial<AppConfig>): ClientWebsiteData {
  const cfg = { ...getEnvironmentConfig(), ...customConfig };
  return {
    ...TEMPLATE_SAAS_AI,
    clientName: cfg.clientBrandName,
    heroHeadline: `Autonomous AI Execution for ${cfg.clientBrandName}`,
    heroSubheadline: cfg.clientTagline,
    deployment: {
      ...TEMPLATE_SAAS_AI.deployment,
      edgeRegion: cfg.edgeRegion,
    }
  };
}

export function getDynamicDashboardMetrics(customConfig?: Partial<AppConfig>): DashboardMetric[] {
  return [
    {
      id: 'kpi-1',
      label: 'Total Marketing Pipeline',
      value: '$4,842,500',
      change: '+38.4%',
      isPositive: true,
      timeframe: 'vs last 30 days',
      sparkline: [28, 34, 40, 48, 52, 60, 72, 85, 94]
    },
    {
      id: 'kpi-2',
      label: 'Campaign Conversion Rate',
      value: '6.84%',
      change: '+2.1%',
      isPositive: true,
      timeframe: 'industry avg 2.4%',
      sparkline: [3.2, 3.8, 4.2, 4.9, 5.5, 6.1, 6.8]
    },
    {
      id: 'kpi-3',
      label: 'Return on Ad Spend (ROAS)',
      value: '4.62x',
      change: '+1.2x',
      isPositive: true,
      timeframe: 'active Q4 campaigns',
      sparkline: [2.8, 3.1, 3.5, 3.9, 4.1, 4.4, 4.62]
    },
    {
      id: 'kpi-4',
      label: 'Agent Execution Velocity',
      value: '99.4%',
      change: '4.32s avg',
      isPositive: true,
      timeframe: '18/18 tests green',
      sparkline: [95, 96, 98, 97, 99, 99.4]
    }
  ];
}

export function getDynamicBrandKit(customConfig?: Partial<AppConfig>): BrandKitData {
  const cfg = { ...getEnvironmentConfig(), ...customConfig };
  return {
    brandName: cfg.clientBrandName,
    tagline: cfg.clientTagline,
    mission: cfg.clientMission,
    primaryColor: '#09090b',
    secondaryColor: '#2563eb',
    accentColor: '#10b981',
    neutralDark: '#18181b',
    neutralLight: '#f4f4f5',
    fontHeading: 'Plus Jakarta Sans',
    fontBody: 'Plus Jakarta Sans',
    logoKeywords: ['Minimalist Monogram', 'Futuristic Geometry', 'Sharp Precision', 'Dynamic Elevation'],
    generatedImages: [
      {
        id: 'img-1',
        prompt: `Futuristic architectural flagship showroom with illuminated holographic brand display of ${cfg.clientBrandName}, ultra minimalist luxury aesthetic, 8k render, octane lighting`,
        imageUrl: 'https://images.unsplash.com/photo-1508873696983-2df5293cb32f?w=800&auto=format&fit=crop&q=80',
        model: 'gemini-3.1-flash-image-preview',
        aspectRatio: '16:9',
        timestamp: 'Today 9:30 AM',
        tags: ['Showroom', '3D Render', 'Flagship']
      },
      {
        id: 'img-2',
        prompt: 'Minimalist luxury mobile device floating over carbon matte pedestal showcasing sleek neon UI dashboard, studio lighting, deep shadows',
        imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
        model: 'gemini-3.1-flash-image-preview',
        aspectRatio: '1:1',
        timestamp: 'Today 9:35 AM',
        tags: ['Mockup', 'App Concept', 'Editorial']
      },
      {
        id: 'img-3',
        prompt: 'High fashion editorial model holding transparent glass tablet with glowing emerald wireframe schematics in brutalist concrete auditorium',
        imageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&auto=format&fit=crop&q=80',
        model: 'gemini-3.1-flash-image-preview',
        aspectRatio: '3:4',
        timestamp: 'Today 9:38 AM',
        tags: ['Campaign', 'Hero Banner', 'Editorial']
      }
    ],
    generatedVideos: [
      {
        id: 'vid-1',
        prompt: 'Cinematic camera flythrough of sleek obsidian geometric glass monolith glowing with subtle emerald pulses, smooth 60fps drone rotation, atmospheric volumetric mist',
        posterUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop&q=80',
        videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-screens-with-charts-31911-large.mp4',
        aspectRatio: '16:9',
        duration: '0:08',
        status: 'ready',
        model: 'veo-3.1-fast-generate-preview',
        timestamp: 'Today 9:40 AM'
      },
      {
        id: 'vid-2',
        prompt: 'Dynamic vertical Instagram Reel / TikTok teaser of rapid UI transitions, neon metrics jumping upward, and logo reveal',
        posterUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80',
        videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-vertical-animation-of-blue-and-purple-lights-41372-large.mp4',
        aspectRatio: '9:16',
        duration: '0:06',
        status: 'ready',
        model: 'veo-3.1-fast-generate-preview',
        timestamp: 'Today 9:42 AM'
      }
    ]
  };
}

export function getDynamicMessages(customConfig?: Partial<AppConfig>): ChatMessageItem[] {
  const cfg = { ...getEnvironmentConfig(), ...customConfig };
  return [
    {
      id: 'msg-welcome',
      role: 'agent',
      authorName: cfg.agentName,
      authorInitials: cfg.agentInitials,
      authorAvatarBg: 'bg-zinc-900 dark:bg-emerald-600 text-white',
      timestamp: 'Just now',
      content: `I'm connected to your local repository (\`${cfg.defaultPath}\`) on branch \`${cfg.defaultBranch}\` via ExecOS local bridge (Port ${cfg.execOsPort}). 

I can synthesize 4-slide enterprise presentation decks, scaffold responsive client websites with live CMS, execute automated test suites, and generate 1K brand assets. What would you like to build or run?`,
      reactions: ['thumbs-up', 'smile', 'clipboard']
    }
  ];
}

// Initial statically-resolved exports for backward-compatibility
export const INITIAL_COLLABORATORS = getDynamicCollaborators();
export const INITIAL_PRESENTATION = getDynamicPresentation();
export const INITIAL_CLIENT_WEBSITE = getDynamicClientWebsite();
export const INITIAL_DASHBOARD_METRICS = getDynamicDashboardMetrics();
export const INITIAL_BRAND_KIT = getDynamicBrandKit();
export const INITIAL_MESSAGES = getDynamicMessages();
