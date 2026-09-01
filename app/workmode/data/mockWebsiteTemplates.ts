import { ClientWebsiteData, SitePresetTemplate } from '../types';

export const INITIAL_SITE_BLOCKS = [
  {
    id: 'block-navbar',
    type: 'navbar' as const,
    name: 'Top Navigation Bar',
    enabled: true,
  },
  {
    id: 'block-hero',
    type: 'hero' as const,
    name: 'Main Hero Section',
    enabled: true,
    badge: 'Next-Generation Architecture',
    headline: 'The Autonomous Execution Engine For High-Velocity Teams',
    subheadline: 'Empower your enterprise with autonomous AI agents, instant high-fidelity marketing artifacts, live collaborative CMS editing, and edge deployment.',
    primaryCtaText: 'Explore Live Demonstration',
    primaryCtaUrl: '#demo',
    secondaryCtaText: 'View Technical Architecture',
    secondaryCtaUrl: '#features',
    align: 'center' as const
  },
  {
    id: 'block-stats',
    type: 'stats' as const,
    name: 'Impact & ROI Metrics',
    enabled: true,
    headline: 'Trusted by over 450+ scale-ups and high-growth engineering teams'
  },
  {
    id: 'block-features',
    type: 'features' as const,
    name: 'Core Platform Capabilities',
    enabled: true,
    badge: 'Engineered for Performance',
    headline: 'Everything You Need to Build, Deploy & Iterate Fast',
    subheadline: 'A comprehensive suite of multi-agent capabilities built for teams that demand velocity.'
  },
  {
    id: 'block-bento',
    type: 'bento' as const,
    name: 'Bento Grid Deep-Dive',
    enabled: true,
    badge: 'Autonomous Intelligence',
    headline: 'Deep Orchestration at Every Level',
    subheadline: 'From code synthesis to brand kits and customer telemetry.'
  },
  {
    id: 'block-pricing',
    type: 'pricing' as const,
    name: 'Pricing & Plans Matrix',
    enabled: true,
    badge: 'Transparent Commercials',
    headline: 'Predictable Pricing Designed to Scale With You',
    subheadline: 'Choose the optimal tier for your team or organization.'
  },
  {
    id: 'block-testimonials',
    type: 'testimonials' as const,
    name: 'Customer Success & Testimonials',
    enabled: true,
    badge: 'Client Validation',
    headline: 'What Industry Leaders Are Saying',
    subheadline: 'Real outcomes delivered across Fortune 500 manufacturing, fintech, and media leaders.'
  },
  {
    id: 'block-faq',
    type: 'faq' as const,
    name: 'Frequently Asked Questions',
    enabled: true,
    badge: 'Got Questions?',
    headline: 'Everything You Need to Know',
    subheadline: 'Answers to the most common questions regarding agent sandboxes, data security, and hosting.'
  },
  {
    id: 'block-lead',
    type: 'leadCapture' as const,
    name: 'Interactive Lead & Beta Form',
    enabled: true,
    headline: 'Ready to Experience Autonomous Asset Delivery?',
    subheadline: 'Join over 10,000+ engineers and product leaders accelerating their go-to-market execution.'
  },
  {
    id: 'block-footer',
    type: 'footer' as const,
    name: 'Footer & Legal',
    enabled: true
  }
];

export const TEMPLATE_SAAS_AI: ClientWebsiteData = {
  id: 'site-apex-brand',
  title: 'Apex Dynamics — Autonomous Enterprise Engine',
  clientName: 'Apex Dynamics',
  tagline: 'Autonomous AI Infrastructure for High-Velocity Teams',
  heroHeadline: 'The Autonomous Execution Engine For High-Velocity Teams',
  heroSubheadline: 'Empower your enterprise with autonomous AI agents, instant high-fidelity marketing artifacts, live collaborative CMS editing, and edge deployment.',
  primaryCta: 'Explore Live Demonstration',
  primaryCtaUrl: '#pricing',
  secondaryCta: 'View Technical Architecture',
  secondaryCtaUrl: '#features',
  accentColor: '#2563eb',
  theme: {
    primaryColor: '#2563eb',
    accentColor: '#10b981',
    backgroundTheme: 'dark',
    fontFamily: 'sans',
    borderRadius: 'lg',
    showGridLines: true
  },
  blocks: INITIAL_SITE_BLOCKS,
  navLinks: [
    { id: 'nl-1', label: 'Features', href: '#features' },
    { id: 'nl-2', label: 'Architecture', href: '#bento' },
    { id: 'nl-3', label: 'Pricing', href: '#pricing' },
    { id: 'nl-4', label: 'Testimonials', href: '#testimonials' },
    { id: 'nl-5', label: 'FAQ', href: '#faq' }
  ],
  stats: [
    { id: 'st-1', label: 'Asset Render Velocity', value: '4.2s', change: '98% faster' },
    { id: 'st-2', label: 'Automated Test Pass Rate', value: '100%', change: '18/18 Suites' },
    { id: 'st-3', label: 'Enterprise Pipeline ARR', value: '+$4.8M', change: '+42% QoQ' },
    { id: 'st-4', label: 'Global Edge Latency', value: '<35ms', change: 'Cloudflare' }
  ],
  features: [
    {
      id: 'f-1',
      icon: 'sparkles',
      title: 'Instant Artifact Synthesis',
      desc: 'Generate client-ready pitch decks, responsive landing pages, and interactive analytics from a single conversation turn.',
      tag: 'Multi-Modal'
    },
    {
      id: 'f-2',
      icon: 'terminal',
      title: 'Zero-Leak Sandboxed Execution',
      desc: 'Every code modification, unit test, and deployment runs in an isolated local execution environment with real-time streaming output.',
      tag: 'Secure AST'
    },
    {
      id: 'f-3',
      icon: 'activity',
      title: 'Real-Time Telemetry & Insights',
      desc: 'Monitor pipeline throughput, customer sentiment indices, and campaign conversion rates with sub-second data freshness.',
      tag: 'Live Sync'
    },
    {
      id: 'f-4',
      icon: 'layers',
      title: 'Component Block Engine',
      desc: 'Compose landing pages with dynamic modular blocks. Drag, reorder, and hot-swap content without engineering bottlenecks.',
      tag: 'Realtime CMS'
    },
    {
      id: 'f-5',
      icon: 'cpu',
      title: 'Dual Model Switching',
      desc: 'Seamlessly switch between Gemini 3.5 Flash for rapid prototyping and Gemini Pro for deep reasoning and code reviews.',
      tag: 'AI Core'
    },
    {
      id: 'f-6',
      icon: 'globe',
      title: 'Edge Instant Deployment',
      desc: 'Publish with SSL certificates, automated DNS routing, and global CDN caching in under 2 seconds.',
      tag: 'Global Edge'
    }
  ],
  pricingTiers: [
    {
      id: 'p-1',
      name: 'Starter Agent',
      price: '$1,800',
      annualPrice: '$1,440',
      period: '/ month',
      description: 'Ideal for early-stage teams wanting rapid brand and website creation.',
      features: [
        'Up to 2 Collaborative AI Agents',
        'Real-time CMS inline editing',
        '10 Presentation Decks / mo',
        'Edge CDN Hosting included',
        'Community Discord & Email Support'
      ],
      popular: false,
      ctaText: 'Start 14-Day Free Trial'
    },
    {
      id: 'p-2',
      name: 'Scale Enterprise',
      price: '$4,500',
      annualPrice: '$3,600',
      period: '/ month',
      description: 'Designed for fast-growing venture-backed startups and marketing orgs.',
      features: [
        'Up to 10 Collaborative AI Agents',
        'Unlimited CMS blocks & custom domains',
        'Veo Video & 4K Image Generation',
        'Full Sandbox Terminal & AST execution',
        'Dedicated Solutions Architect',
        'Custom SSO & 99.99% SLA'
      ],
      popular: true,
      ctaText: 'Deploy Enterprise Workspace'
    },
    {
      id: 'p-3',
      name: 'Global Corporation',
      price: 'Custom',
      annualPrice: 'Custom',
      period: 'tailored',
      description: 'Full-scale on-premise or dedicated private cloud deployment.',
      features: [
        'Unlimited AI Agents & Workspaces',
        'Private VPC & Zero-Egress VPC peering',
        'Custom Fine-Tuned Model Weights',
        '24/7 Dedicated Incident Response',
        'Quarterly Executive Strategy Reviews'
      ],
      popular: false,
      ctaText: 'Contact Enterprise Sales'
    }
  ],
  testimonials: [
    {
      id: 't-1',
      quote: 'Agent Sam reduced our landing page and pitch deck turnaround time from 3 weeks to literally 8 minutes. The real-time CMS editor is breathtaking.',
      author: 'Elena Rostova',
      role: 'VP of Product Marketing',
      company: 'Apex Technologies',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      rating: 5
    },
    {
      id: 't-2',
      quote: 'We deployed our entire YC launch website, slide deck, and brand kit in one afternoon. The edge deployment with custom domain routing worked on the first try.',
      author: 'Marcus Sterling',
      role: 'Founder & CEO',
      company: 'Veloce AI',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
      rating: 5
    },
    {
      id: 't-3',
      quote: 'The ability to live inline-edit copy while Agent Sam runs automated test assertions in the slide-up terminal drawer gives us complete peace of mind.',
      author: 'Sophia Zhang',
      role: 'Lead Architect',
      company: 'HyperScale Systems',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80',
      rating: 5
    }
  ],
  faqs: [
    {
      id: 'faq-1',
      question: 'How does real-time CMS editing work with the live website preview?',
      answer: 'You can toggle "Inline Edit" on the preview canvas and click directly on any headline, card, badge, or price to edit it immediately. Or open the CMS Inspector drawer for full block control.'
    },
    {
      id: 'faq-2',
      question: 'Can I deploy the website to my own custom domain?',
      answer: 'Yes! The deployment engine supports instant subdomains (e.g., https://yourbrand.apexdynamics.live) as well as custom CNAME root domains with automated SSL certificate provisioning.'
    },
    {
      id: 'faq-3',
      question: 'Can I export clean standalone HTML and JSON code?',
      answer: 'Yes. In the Export Hub, click "Download Standalone HTML" to get a self-contained, fully styled production file, or export CMS JSON to plug into Next.js, Remix, Astro, or Strapi.'
    },
    {
      id: 'faq-4',
      question: 'How do AI prompts modify the site structure?',
      answer: 'Simply tell Agent Sam in chat (e.g. "Add a FAQ section with questions about SOC-2 compliance" or "Change hero to focus on fintech developers") and the AST parser updates the CMS in real-time.'
    }
  ],
  seo: {
    metaTitle: 'Apex Dynamics — Autonomous Enterprise AI Infrastructure',
    metaDescription: 'High-velocity autonomous multi-agent platform for real-time website scaffolding, presentation compilation, and live CMS deployment.',
    ogImage: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200'
  },
  deployment: {
    status: 'deployed',
    subdomain: 'preview',
    deployedUrl: 'https://preview.apexdynamics.ai',
    customDomain: 'apex.io',
    lastDeployedAt: 'Just now (v2.4.1)',
    version: 'v2.4.1',
    sslStatus: 'active',
    edgeRegion: 'us-east1 (Cloud Run Edge)',
    commitHash: 'c8f2a14',
    buildLogs: [
      '✔ AST component hierarchy compiled',
      '✔ Tailwind v4 atomic classes tree-shaken (14.2 kB)',
      '✔ SSL certificate verified for apex.io',
      '✔ Edge CDN deployed across 34 global regions'
    ]
  }
};

export const TEMPLATE_FINTECH: ClientWebsiteData = {
  ...TEMPLATE_SAAS_AI,
  id: 'site-aurora-fintech',
  title: 'Aurora Pay — Embedded Global Treasury & Payments API',
  clientName: 'Aurora Financial',
  tagline: 'Developer-First Treasury & Cross-Border Settlement Infrastructure',
  heroHeadline: 'Move Capital Across 140+ Currencies at Millisecond Speeds',
  heroSubheadline: 'Unified banking APIs, instant multi-currency accounts, and automated FX risk hedging built for global commerce leaders.',
  primaryCta: 'Get Production API Keys',
  primaryCtaUrl: '#pricing',
  secondaryCta: 'Read Developer Docs',
  secondaryCtaUrl: '#features',
  accentColor: '#059669',
  theme: {
    primaryColor: '#059669',
    accentColor: '#10b981',
    backgroundTheme: 'midnight',
    fontFamily: 'mono',
    borderRadius: 'md',
    showGridLines: true
  },
  stats: [
    { id: 'st-1', label: 'Annual TPV Processed', value: '$840M+', change: '+180% YoY' },
    { id: 'st-2', label: 'Average Settlement Time', value: '1.2s', change: 'SEPA & FedNow' },
    { id: 'st-3', label: 'API Uptime SLA', value: '99.999%', change: 'Zero Downtime' },
    { id: 'st-4', label: 'Global Liquidity Pools', value: '42', change: 'Tier-1 Banks' }
  ],
  pricingTiers: [
    {
      id: 'p-1',
      name: 'Developer Sandbox',
      price: '$0',
      annualPrice: '$0',
      period: 'forever',
      description: 'Full sandbox API access with simulated multi-currency rails.',
      features: ['Up to 10,000 sandbox API calls/mo', 'Test webhooks & ISO 20022 schemas', 'Community support'],
      popular: false,
      ctaText: 'Create Sandbox Account'
    },
    {
      id: 'p-2',
      name: 'Production Scale',
      price: '$950',
      annualPrice: '$760',
      period: '/ month + 0.15%',
      description: 'For fintechs and SaaS platforms processing live consumer transactions.',
      features: ['Instant KYC & AML screening', 'Same-day SEPA / FedNow / ACH', 'Dedicated webhook queue', 'Multi-tenant sub-wallets'],
      popular: true,
      ctaText: 'Activate Live Processing'
    },
    {
      id: 'p-3',
      name: 'Institutional Rails',
      price: 'Custom',
      annualPrice: 'Custom',
      period: 'volume-based',
      description: 'Direct core-banking integration for licensed brokerages and banks.',
      features: ['Direct SWIFT GPI integration', 'Custom FX spread tiers', '24/7 dedicated treasury team'],
      popular: false,
      ctaText: 'Schedule Institutional Demo'
    }
  ]
};

export const TEMPLATE_AGENCY: ClientWebsiteData = {
  ...TEMPLATE_SAAS_AI,
  id: 'site-atelier-creative',
  title: 'Atelier Studio — Visionary Design & Brand Strategy',
  clientName: 'Atelier Creative Co.',
  tagline: 'High-Impact Brand Identity & Digital Art Direction for Category Creators',
  heroHeadline: 'Crafting Iconic Brand Systems for Tomorrow’s Category Leaders',
  heroSubheadline: 'We partner with ambitious founders to engineer distinctive visual identities, bespoke digital experiences, and immersive product storytelling.',
  primaryCta: 'View Curated Work',
  primaryCtaUrl: '#features',
  secondaryCta: 'Inquire for Q4 Commission',
  secondaryCtaUrl: '#lead',
  accentColor: '#d97706',
  theme: {
    primaryColor: '#d97706',
    accentColor: '#f59e0b',
    backgroundTheme: 'warm',
    fontFamily: 'serif',
    borderRadius: 'none',
    showGridLines: false
  }
};

export const SITE_PRESET_TEMPLATES: SitePresetTemplate[] = [
  {
    id: 'preset-saas-enterprise',
    name: 'SaaS AI Platform & Execution Engine',
    industry: 'Enterprise B2B Software',
    description: 'High-converting modern dark SaaS template with live metrics, bento grid, and interactive tier pricing.',
    category: 'saas',
    badge: 'Most Popular',
    accentColor: '#2563eb',
    website: TEMPLATE_SAAS_AI
  },
  {
    id: 'preset-fintech-api',
    name: 'Fintech & Developer Banking Rails',
    industry: 'Financial Technology',
    description: 'Developer-focused theme featuring terminal code previews, liquidity statistics, and volume-based pricing.',
    category: 'fintech',
    badge: 'Developer-First',
    accentColor: '#059669',
    website: TEMPLATE_FINTECH
  },
  {
    id: 'preset-agency-creative',
    name: 'Luxury Creative Studio & Art Direction',
    industry: 'Brand & Design Agency',
    description: 'Editorial typography, warm minimalist layout, curated case study gallery, and bespoke client intake.',
    category: 'agency',
    badge: 'Editorial Chic',
    accentColor: '#d97706',
    website: TEMPLATE_AGENCY
  }
];
