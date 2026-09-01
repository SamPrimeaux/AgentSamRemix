import React, { useState } from 'react';
import { 
  ClientWebsiteData, 
  SiteBlock, 
  SiteFeatureItem, 
  SitePricingTier, 
  SiteTestimonial, 
  SiteFaqItem, 
  SiteStatItem 
} from '../types';
import { 
  Smartphone, 
  Tablet, 
  Monitor, 
  ExternalLink, 
  Sparkles, 
  Terminal, 
  Activity, 
  Layers, 
  Cpu, 
  Globe, 
  Shield, 
  Zap, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Edit3, 
  ArrowRight, 
  Lock, 
  RotateCw, 
  Maximize2,
  Send,
  Star,
  Plus,
  Trash2,
  Eye
} from 'lucide-react';
import { cn } from '../../lib/utils';
import confetti from 'canvas-confetti';

interface LiveWebsiteSandboxProps {
  website: ClientWebsiteData;
  onUpdateWebsite: (updated: ClientWebsiteData) => void;
  isInlineEditMode: boolean;
  onToggleInlineEdit: () => void;
  onSelectBlockForCms?: (blockId: string) => void;
  onOpenDeployModal?: () => void;
}

export const LiveWebsiteSandbox: React.FC<LiveWebsiteSandboxProps> = ({
  website,
  onUpdateWebsite,
  isInlineEditMode,
  onToggleInlineEdit,
  onSelectBlockForCms,
  onOpenDeployModal
}) => {
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [openFaqId, setOpenFaqId] = useState<string | null>(website.faqs?.[0]?.id || null);
  const [leadEmail, setLeadEmail] = useState('');
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [activeInlineField, setActiveInlineField] = useState<string | null>(null);

  // Helper to update top-level field
  const updateField = (key: keyof ClientWebsiteData, value: any) => {
    onUpdateWebsite({
      ...website,
      [key]: value
    });
  };

  // Helper to update specific block field
  const updateBlockField = (blockId: string, field: string, value: any) => {
    const updatedBlocks = website.blocks.map(b => 
      b.id === blockId ? { ...b, [field]: value } : b
    );
    onUpdateWebsite({
      ...website,
      blocks: updatedBlocks
    });
  };

  // Helper for features
  const updateFeature = (id: string, field: keyof SiteFeatureItem, val: string) => {
    const updated = website.features.map(f => f.id === id ? { ...f, [field]: val } : f);
    onUpdateWebsite({ ...website, features: updated });
  };

  // Helper for pricing
  const updatePricing = (id: string, field: keyof SitePricingTier, val: any) => {
    const updated = website.pricingTiers.map(p => p.id === id ? { ...p, [field]: val } : p);
    onUpdateWebsite({ ...website, pricingTiers: updated });
  };

  // Helper for FAQs
  const updateFaq = (id: string, field: keyof SiteFaqItem, val: string) => {
    const updated = website.faqs.map(q => q.id === id ? { ...q, [field]: val } : q);
    onUpdateWebsite({ ...website, faqs: updated });
  };

  // Helper for Stats
  const updateStat = (id: string, field: keyof SiteStatItem, val: string) => {
    const updated = website.stats.map(s => s.id === id ? { ...s, [field]: val } : s);
    onUpdateWebsite({ ...website, stats: updated });
  };

  const handleLeadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadEmail) return;
    setLeadSubmitted(true);
    confetti({ particleCount: 40, spread: 60 });
    setTimeout(() => {
      setLeadSubmitted(false);
      setLeadEmail('');
    }, 4000);
  };

  const getFeatureIcon = (iconName: string) => {
    switch (iconName.toLowerCase()) {
      case 'terminal': return <Terminal size={18} />;
      case 'activity': return <Activity size={18} />;
      case 'layers': return <Layers size={18} />;
      case 'cpu': return <Cpu size={18} />;
      case 'globe': return <Globe size={18} />;
      case 'shield': return <Shield size={18} />;
      case 'zap': return <Zap size={18} />;
      default: return <Sparkles size={18} />;
    }
  };

  const bgThemeClass = () => {
    switch (website.theme?.backgroundTheme) {
      case 'light': return 'bg-white text-zinc-900';
      case 'midnight': return 'bg-slate-950 text-slate-100';
      case 'mesh': return 'bg-gradient-to-br from-zinc-950 via-indigo-950 to-zinc-900 text-zinc-100';
      case 'warm': return 'bg-stone-50 text-stone-900';
      case 'dark':
      default: return 'bg-zinc-950 text-zinc-100';
    }
  };

  const fontThemeClass = () => {
    switch (website.theme?.fontFamily) {
      case 'serif': return 'font-serif';
      case 'mono': return 'font-mono';
      case 'sans':
      default: return 'font-sans';
    }
  };

  const radiusThemeClass = () => {
    switch (website.theme?.borderRadius) {
      case 'none': return 'rounded-none';
      case 'sm': return 'rounded-md';
      case 'md': return 'rounded-xl';
      case 'full': return 'rounded-3xl';
      case 'lg':
      default: return 'rounded-2xl';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-zinc-100/70 dark:bg-zinc-900/70 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
      {/* Top Browser Chrome Bar */}
      <div className="px-3 sm:px-4 py-2.5 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 shrink-0 flex-wrap">
        {/* Left: Window Dots & Address */}
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-[200px]">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/80 hover:opacity-100 transition-opacity" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 hover:opacity-100 transition-opacity" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 hover:opacity-100 transition-opacity" />
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-300 font-mono flex-1 max-w-sm truncate">
            <Lock size={11} className="text-emerald-500 shrink-0" />
            <span className="truncate">{website.deployment?.deployedUrl || `https://${website.deployment?.subdomain || 'preview'}.apexdynamics.ai`}</span>
          </div>
        </div>

        {/* Center: Device Viewport Controls */}
        <div className="flex items-center p-0.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs">
          <button
            onClick={() => setDevice('desktop')}
            title="Desktop View"
            className={cn(
              "p-1.5 rounded-lg flex items-center gap-1 transition-all",
              device === 'desktop' ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs font-semibold" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            <Monitor size={14} />
            <span className="hidden md:inline text-[11px]">Desktop</span>
          </button>
          <button
            onClick={() => setDevice('tablet')}
            title="Tablet View (768px)"
            className={cn(
              "p-1.5 rounded-lg flex items-center gap-1 transition-all",
              device === 'tablet' ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs font-semibold" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            <Tablet size={14} />
            <span className="hidden md:inline text-[11px]">Tablet</span>
          </button>
          <button
            onClick={() => setDevice('mobile')}
            title="Mobile View (390px)"
            className={cn(
              "p-1.5 rounded-lg flex items-center gap-1 transition-all",
              device === 'mobile' ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs font-semibold" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            <Smartphone size={14} />
            <span className="hidden md:inline text-[11px]">Mobile</span>
          </button>
        </div>

        {/* Right: Inline Edit Mode Pill & Deploy Action */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onToggleInlineEdit}
            title={isInlineEditMode ? "Exit Inline Edit Mode" : "Turn on Click-to-Edit Mode"}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs border",
              isInlineEditMode
                ? "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400 font-bold animate-pulse"
                : "bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            )}
          >
            <Edit3 size={13} />
            <span>{isInlineEditMode ? 'Live CMS Edit ON' : 'Live CMS Edit'}</span>
          </button>

          {onOpenDeployModal && (
            <button
              onClick={onOpenDeployModal}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 shadow-sm active:scale-95 transition-all"
            >
              <Globe size={13} />
              <span>Deploy</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Edit Notice Banner if Active */}
      {isInlineEditMode && (
        <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300 flex items-center justify-between shrink-0">
          <span className="flex items-center gap-1.5">
            <Sparkles size={12} className="text-amber-500" />
            <strong>Real-time Inline CMS Mode:</strong> Click any headline, badge, price, or text on the canvas below to edit live.
          </span>
          <button
            onClick={onToggleInlineEdit}
            className="text-[10px] underline hover:no-underline font-semibold"
          >
            Done Editing
          </button>
        </div>
      )}

      {/* Main Viewport Stage */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-4 md:p-6 flex justify-center items-start bg-zinc-200/40 dark:bg-black/40">
        <div 
          className={cn(
            "w-full transition-all duration-300 shadow-2xl border border-zinc-200/80 dark:border-zinc-800/80 overflow-hidden",
            bgThemeClass(),
            fontThemeClass(),
            device === 'mobile' && "max-w-[390px] rounded-[36px] min-h-[780px]",
            device === 'tablet' && "max-w-[768px] rounded-3xl min-h-[850px]",
            device === 'desktop' && "max-w-5xl rounded-2xl min-h-[900px]"
          )}
        >
          {/* ================= SECTION: NAVBAR ================= */}
          {website.blocks.find(b => b.type === 'navbar')?.enabled !== false && (
            <nav className="w-full px-5 sm:px-8 py-4 border-b border-zinc-200/40 dark:border-zinc-800/40 flex items-center justify-between sticky top-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md z-20">
              <div className="flex items-center gap-2.5">
                <div 
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-md"
                  style={{ backgroundColor: website.accentColor || '#2563eb' }}
                >
                  {website.clientName?.charAt(0) || 'A'}
                </div>
                <div>
                  <div className="font-extrabold text-sm tracking-tight">{website.clientName}</div>
                  <div className="text-[10px] text-zinc-400 hidden sm:block">{website.tagline}</div>
                </div>
              </div>

              <div className="hidden md:flex items-center gap-6 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {website.navLinks?.map(nl => (
                  <a key={nl.id} href={nl.href} className="hover:text-zinc-900 dark:hover:text-white transition-colors">
                    {nl.label}
                  </a>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button 
                  className="px-4 py-1.5 text-xs font-semibold rounded-full text-white shadow-sm transition-transform active:scale-95"
                  style={{ backgroundColor: website.accentColor || '#2563eb' }}
                >
                  {website.primaryCta || 'Get Started'}
                </button>
              </div>
            </nav>
          )}

          {/* Render Active Dynamic Blocks */}
          <div className="divide-y divide-zinc-200/20 dark:divide-zinc-800/20">
            {website.blocks.filter(b => b.enabled).map((block) => {
              // ================= SECTION: HERO =================
              if (block.type === 'hero') {
                return (
                  <section 
                    key={block.id} 
                    id="hero"
                    className={cn(
                      "px-6 sm:px-12 py-12 sm:py-20 text-center space-y-6 relative overflow-hidden group",
                      isInlineEditMode && "hover:outline hover:outline-2 hover:outline-blue-500/50 hover:bg-blue-500/5 transition-all cursor-text rounded-xl"
                    )}
                  >
                    {/* Background Glow */}
                    <div 
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl opacity-20 pointer-events-none"
                      style={{ backgroundColor: website.accentColor || '#2563eb' }}
                    />

                    {/* Section Badge */}
                    <div className="relative inline-flex items-center gap-2">
                      {isInlineEditMode ? (
                        <input
                          type="text"
                          value={block.badge || 'Next-Generation Platform'}
                          onChange={(e) => updateBlockField(block.id, 'badge', e.target.value)}
                          className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30 text-center outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="px-3.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1.5 shadow-xs">
                          <Sparkles size={13} />
                          <span>{block.badge || 'Next-Generation Platform'}</span>
                        </span>
                      )}
                    </div>

                    {/* Main Hero Headline */}
                    <div className="relative max-w-3xl mx-auto">
                      {isInlineEditMode ? (
                        <textarea
                          rows={2}
                          value={website.heroHeadline}
                          onChange={(e) => updateField('heroHeadline', e.target.value)}
                          className="w-full text-2xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-center bg-transparent border border-dashed border-amber-500/50 rounded-xl p-2 outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      ) : (
                        <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
                          {website.heroHeadline}
                        </h1>
                      )}
                    </div>

                    {/* Hero Subheadline */}
                    <div className="relative max-w-2xl mx-auto">
                      {isInlineEditMode ? (
                        <textarea
                          rows={2}
                          value={website.heroSubheadline}
                          onChange={(e) => updateField('heroSubheadline', e.target.value)}
                          className="w-full text-xs sm:text-base text-zinc-400 text-center bg-transparent border border-dashed border-amber-500/50 rounded-xl p-2 outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      ) : (
                        <p className="text-xs sm:text-base text-zinc-500 dark:text-zinc-400 leading-relaxed">
                          {website.heroSubheadline}
                        </p>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-center gap-3 pt-3 flex-wrap relative z-10">
                      {isInlineEditMode ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={website.primaryCta}
                            onChange={(e) => updateField('primaryCta', e.target.value)}
                            className="px-4 py-2 rounded-full text-xs font-bold text-white bg-blue-600 border border-blue-400 text-center outline-none"
                          />
                          <input
                            type="text"
                            value={website.secondaryCta}
                            onChange={(e) => updateField('secondaryCta', e.target.value)}
                            className="px-4 py-2 rounded-full text-xs font-bold bg-zinc-800 text-zinc-200 border border-zinc-700 text-center outline-none"
                          />
                        </div>
                      ) : (
                        <>
                          <button 
                            onClick={() => {
                              const pricingEl = document.getElementById('pricing');
                              pricingEl?.scrollIntoView({ behavior: 'smooth' });
                            }}
                            className="px-6 py-2.5 rounded-full text-white font-bold text-xs sm:text-sm shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                            style={{ backgroundColor: website.accentColor || '#2563eb' }}
                          >
                            <span>{website.primaryCta}</span>
                            <ArrowRight size={14} />
                          </button>
                          <button 
                            onClick={() => {
                              const featEl = document.getElementById('features');
                              featEl?.scrollIntoView({ behavior: 'smooth' });
                            }}
                            className="px-6 py-2.5 rounded-full bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-semibold text-xs sm:text-sm border border-zinc-200 dark:border-zinc-800 transition-colors"
                          >
                            {website.secondaryCta}
                          </button>
                        </>
                      )}
                    </div>

                    {/* Interactive Mockup Hero Frame */}
                    <div className="mt-8 max-w-3xl mx-auto rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-900/80 p-3 sm:p-4 shadow-2xl backdrop-blur-md text-left">
                      <div className="flex items-center justify-between pb-3 border-b border-zinc-800 text-xs text-zinc-400 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          <span>agentsam-pipeline.sh — execution output</span>
                        </div>
                        <span className="text-emerald-400 font-bold">PASS 18/18</span>
                      </div>
                      <div className="py-3 font-mono text-xs text-zinc-300 space-y-1">
                        <div className="text-zinc-500"># Autonomous pipeline initialized: AST AST validated</div>
                        <div className="text-blue-400">✔ Scaffolding landing components (Hero, Bento, Tiers, Telemetry)... Done</div>
                        <div className="text-violet-400">✔ Real-time CMS sync state: WebSocket connection open</div>
                        <div className="text-emerald-400 font-semibold">✔ Edge CDN build output: 14.2ms TTFB</div>
                      </div>
                    </div>
                  </section>
                );
              }

              // ================= SECTION: STATS =================
              if (block.type === 'stats' && website.stats && website.stats.length > 0) {
                return (
                  <section key={block.id} className="px-6 sm:px-12 py-8 bg-zinc-100/50 dark:bg-zinc-900/50">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-4xl mx-auto">
                      {website.stats.map((s) => (
                        <div key={s.id} className="text-center p-3 space-y-1">
                          {isInlineEditMode ? (
                            <input
                              type="text"
                              value={s.value}
                              onChange={(e) => updateStat(s.id, 'value', e.target.value)}
                              className="text-xl sm:text-3xl font-extrabold text-center bg-transparent border-b border-dashed border-amber-500 outline-none w-full"
                            />
                          ) : (
                            <div className="text-xl sm:text-3xl font-extrabold tracking-tight">{s.value}</div>
                          )}
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{s.label}</div>
                          {s.change && (
                            <div className="text-[10px] text-emerald-500 font-semibold">{s.change}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                );
              }

              // ================= SECTION: FEATURES =================
              if (block.type === 'features') {
                return (
                  <section key={block.id} id="features" className="px-6 sm:px-12 py-14 space-y-8">
                    <div className="text-center max-w-2xl mx-auto space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400">
                        {block.badge || 'Platform Capabilities'}
                      </span>
                      <h2 className="text-xl sm:text-3xl font-bold tracking-tight">
                        {block.headline || 'Engineered for Performance & Scalability'}
                      </h2>
                      <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                        {block.subheadline || 'A comprehensive suite of autonomous tools designed to accelerate your delivery.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
                      {website.features.map((feat) => (
                        <div 
                          key={feat.id}
                          className={cn(
                            "p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/60 shadow-xs space-y-2.5 transition-all hover:border-blue-500/50 group",
                            radiusThemeClass()
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div 
                              className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-xs"
                              style={{ backgroundColor: website.accentColor || '#2563eb' }}
                            >
                              {getFeatureIcon(feat.icon)}
                            </div>
                            {feat.tag && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-semibold">
                                {feat.tag}
                              </span>
                            )}
                          </div>

                          {isInlineEditMode ? (
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={feat.title}
                                onChange={(e) => updateFeature(feat.id, 'title', e.target.value)}
                                className="w-full text-xs font-bold bg-transparent border-b border-dashed border-amber-500 outline-none"
                              />
                              <textarea
                                rows={2}
                                value={feat.desc}
                                onChange={(e) => updateFeature(feat.id, 'desc', e.target.value)}
                                className="w-full text-[11px] text-zinc-400 bg-transparent border border-dashed border-amber-500/50 rounded p-1 outline-none"
                              />
                            </div>
                          ) : (
                            <>
                              <h3 className="font-bold text-xs sm:text-sm">{feat.title}</h3>
                              <p className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                                {feat.desc}
                              </p>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                );
              }

              // ================= SECTION: BENTO GRID =================
              if (block.type === 'bento') {
                return (
                  <section key={block.id} id="bento" className="px-6 sm:px-12 py-14 bg-zinc-50/50 dark:bg-zinc-900/30 space-y-6">
                    <div className="text-center max-w-2xl mx-auto space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-500">
                        {block.badge || 'Deep Architecture'}
                      </span>
                      <h2 className="text-xl sm:text-3xl font-bold tracking-tight">
                        {block.headline || 'Autonomous Intelligence at Every Layer'}
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
                      {/* Large Card 1 */}
                      <div className="md:col-span-2 p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm space-y-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-500 flex items-center justify-center">
                          <Layers size={16} />
                        </div>
                        <h4 className="text-base font-bold">Multi-Agent Sandbox Synchronizer</h4>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                          Agents operate concurrently with shared state memory. When Agent Sam refactors code, Agent Maya updates key visuals and David logs ROI metrics.
                        </p>
                        <div className="pt-2 flex items-center gap-2 text-xs font-mono text-emerald-500">
                          <Check size={14} />
                          <span>Zero concurrency lockouts • Edge distributed</span>
                        </div>
                      </div>

                      {/* Card 2 */}
                      <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm space-y-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-500 flex items-center justify-center">
                          <Terminal size={16} />
                        </div>
                        <h4 className="text-base font-bold">Hot-Reload CMS</h4>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                          Edits made in chat or inline sync instantly to the CDN preview without full redeploy cycles.
                        </p>
                      </div>
                    </div>
                  </section>
                );
              }

              // ================= SECTION: PRICING =================
              if (block.type === 'pricing') {
                return (
                  <section key={block.id} id="pricing" className="px-6 sm:px-12 py-16 space-y-8">
                    <div className="text-center max-w-2xl mx-auto space-y-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400">
                        {block.badge || 'Commercial Tiers'}
                      </span>
                      <h2 className="text-xl sm:text-3xl font-bold tracking-tight">
                        {block.headline || 'Predictable Pricing Designed to Scale'}
                      </h2>
                      <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                        {block.subheadline || 'Simple, transparent pricing. No hidden seat fees or surprising compute bills.'}
                      </p>

                      {/* Monthly vs Annual Toggle */}
                      <div className="inline-flex items-center p-1 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs">
                        <button
                          onClick={() => setBillingCycle('monthly')}
                          className={cn(
                            "px-3.5 py-1 rounded-full font-semibold transition-all",
                            billingCycle === 'monthly' ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs" : "text-zinc-500"
                          )}
                        >
                          Monthly Billing
                        </button>
                        <button
                          onClick={() => setBillingCycle('annual')}
                          className={cn(
                            "px-3.5 py-1 rounded-full font-semibold transition-all flex items-center gap-1.5",
                            billingCycle === 'annual' ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs" : "text-zinc-500"
                          )}
                        >
                          <span>Annual Billing</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-500 font-bold">SAVE 20%</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto items-stretch">
                      {website.pricingTiers.map((tier) => (
                        <div
                          key={tier.id}
                          className={cn(
                            "p-6 rounded-2xl border flex flex-col justify-between transition-all relative",
                            tier.popular
                              ? "bg-zinc-900 text-white dark:bg-zinc-900 border-blue-500 shadow-xl scale-[1.02]"
                              : "bg-white dark:bg-zinc-950 border-zinc-200/80 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs",
                            radiusThemeClass()
                          )}
                        >
                          {tier.popular && (
                            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-blue-600 text-white tracking-wider shadow-sm">
                              Most Popular
                            </span>
                          )}

                          <div className="space-y-4">
                            <div>
                              <h3 className="font-bold text-base">{tier.name}</h3>
                              {tier.description && (
                                <p className="text-[11px] opacity-70 mt-1">{tier.description}</p>
                              )}
                            </div>

                            <div className="space-y-0.5">
                              <div className="text-2xl sm:text-3xl font-extrabold">
                                {billingCycle === 'annual' && tier.annualPrice ? tier.annualPrice : tier.price}
                                <span className="text-xs font-normal opacity-70 ml-1">{tier.period}</span>
                              </div>
                              {billingCycle === 'annual' && tier.annualPrice && (
                                <div className="text-[10px] text-emerald-400 font-medium">Billed annually</div>
                              )}
                            </div>

                            <div className="pt-2 border-t border-zinc-200/20 dark:border-zinc-800/60 space-y-2 text-xs">
                              {tier.features.map((feat, fi) => (
                                <div key={fi} className="flex items-start gap-2">
                                  <Check size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                                  <span className="opacity-80 text-[11px] leading-tight">{feat}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="pt-6">
                            <button
                              onClick={() => {
                                confetti({ particleCount: 50, spread: 70 });
                                alert(`Selected ${tier.name} tier plan!`);
                              }}
                              className={cn(
                                "w-full py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-sm",
                                tier.popular
                                  ? "bg-blue-600 hover:bg-blue-500 text-white"
                                  : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                              )}
                            >
                              {tier.ctaText || 'Select Plan'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              }

              // ================= SECTION: TESTIMONIALS =================
              if (block.type === 'testimonials') {
                return (
                  <section key={block.id} id="testimonials" className="px-6 sm:px-12 py-14 bg-zinc-50/40 dark:bg-zinc-900/20 space-y-8">
                    <div className="text-center max-w-2xl mx-auto space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-blue-500">
                        {block.badge || 'Social Proof'}
                      </span>
                      <h2 className="text-xl sm:text-3xl font-bold tracking-tight">
                        {block.headline || 'What Industry Leaders Are Saying'}
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
                      {website.testimonials.map((t) => (
                        <div
                          key={t.id}
                          className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-xs flex flex-col justify-between space-y-4"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center gap-1 text-amber-400">
                              {[...Array(t.rating || 5)].map((_, i) => (
                                <Star key={i} size={13} className="fill-current" />
                              ))}
                            </div>
                            <p className="text-xs text-zinc-600 dark:text-zinc-300 italic leading-relaxed">
                              "{t.quote}"
                            </p>
                          </div>

                          <div className="flex items-center gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                            <img
                              src={t.avatar}
                              alt={t.author}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-full object-cover shrink-0 border border-zinc-200 dark:border-zinc-700"
                            />
                            <div>
                              <div className="text-xs font-bold">{t.author}</div>
                              <div className="text-[10px] text-zinc-400">{t.role} • {t.company || 'Enterprise'}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              }

              // ================= SECTION: FAQ =================
              if (block.type === 'faq' && website.faqs && website.faqs.length > 0) {
                return (
                  <section key={block.id} id="faq" className="px-6 sm:px-12 py-14 space-y-6">
                    <div className="text-center max-w-2xl mx-auto space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-blue-500">
                        {block.badge || 'Common Inquiries'}
                      </span>
                      <h2 className="text-xl sm:text-3xl font-bold tracking-tight">
                        {block.headline || 'Frequently Asked Questions'}
                      </h2>
                    </div>

                    <div className="max-w-2xl mx-auto space-y-2.5">
                      {website.faqs.map((faq) => {
                        const isOpen = openFaqId === faq.id;
                        return (
                          <div
                            key={faq.id}
                            className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs"
                          >
                            <button
                              onClick={() => setOpenFaqId(isOpen ? null : faq.id)}
                              className="w-full px-5 py-3.5 text-left flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                            >
                              <span>{faq.question}</span>
                              {isOpen ? <ChevronUp size={16} className="text-zinc-400 shrink-0" /> : <ChevronDown size={16} className="text-zinc-400 shrink-0" />}
                            </button>

                            {isOpen && (
                              <div className="px-5 pb-4 text-xs text-zinc-500 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-800/60 pt-3 leading-relaxed">
                                {faq.answer}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              }

              // ================= SECTION: LEAD CAPTURE =================
              if (block.type === 'leadCapture') {
                return (
                  <section key={block.id} id="lead" className="px-6 sm:px-12 py-16 text-center space-y-6 bg-gradient-to-b from-transparent to-blue-500/10 dark:to-blue-950/20">
                    <div className="max-w-xl mx-auto space-y-3">
                      <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight">
                        {block.headline || 'Ready to Accelerate Your GTM Execution?'}
                      </h2>
                      <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                        {block.subheadline || 'Join over 10,000+ forward-thinking founders and product teams building with autonomous multi-agent pipelines.'}
                      </p>

                      <form onSubmit={handleLeadSubmit} className="flex items-center gap-2 max-w-md mx-auto pt-2">
                        <input
                          type="email"
                          required
                          placeholder="Enter your work email..."
                          value={leadEmail}
                          onChange={(e) => setLeadEmail(e.target.value)}
                          className="flex-1 px-4 py-2.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                        />
                        <button
                          type="submit"
                          className="px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md active:scale-95 transition-all shrink-0 flex items-center gap-1.5"
                        >
                          <Send size={13} />
                          <span>Request Access</span>
                        </button>
                      </form>

                      {leadSubmitted && (
                        <div className="text-xs text-emerald-500 font-semibold flex items-center justify-center gap-1.5 animate-in fade-in">
                          <Sparkles size={13} />
                          <span>Thank you! Your enterprise sandbox invitation is being generated.</span>
                        </div>
                      )}
                    </div>
                  </section>
                );
              }

              // ================= SECTION: FOOTER =================
              if (block.type === 'footer') {
                return (
                  <footer key={block.id} className="w-full px-6 sm:px-12 py-10 border-t border-zinc-200/40 dark:border-zinc-800/40 text-xs text-zinc-400 space-y-6">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-2 font-bold text-sm text-zinc-900 dark:text-zinc-100">
                        <div 
                          className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs"
                          style={{ backgroundColor: website.accentColor || '#2563eb' }}
                        >
                          {website.clientName?.charAt(0) || 'A'}
                        </div>
                        <span>{website.clientName}</span>
                      </div>

                      <div className="flex items-center gap-5 text-zinc-500 dark:text-zinc-400">
                        <a href="#features" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Features</a>
                        <a href="#pricing" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Pricing</a>
                        <a href="#faq" className="hover:text-zinc-900 dark:hover:text-white transition-colors">FAQ</a>
                        <a href="#lead" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Contact</a>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-4 border-t border-zinc-200/20 dark:border-zinc-800/20 text-[11px] text-zinc-500">
                      <div>© {new Date().getFullYear()} {website.clientName}. Powered by Agent Sam Autonomous CMS.</div>
                      <div className="flex items-center gap-3">
                        <span>Privacy Policy</span>
                        <span>•</span>
                        <span>Terms of Service</span>
                        <span>•</span>
                        <span>Security AST</span>
                      </div>
                    </div>
                  </footer>
                );
              }

              return null;
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
