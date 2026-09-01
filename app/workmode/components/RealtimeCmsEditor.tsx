import React, { useState } from 'react';
import { 
  ClientWebsiteData, 
  SiteBlock, 
  SiteBlockType, 
  SiteFeatureItem, 
  SitePricingTier, 
  SiteTestimonial, 
  SiteFaqItem, 
  SiteStatItem,
  SitePresetTemplate
} from '../types';
import { 
  SITE_PRESET_TEMPLATES, 
  TEMPLATE_SAAS_AI, 
  TEMPLATE_FINTECH, 
  TEMPLATE_AGENCY 
} from '../data/mockWebsiteTemplates';
import { 
  Layers, 
  Settings, 
  Palette, 
  Sparkles, 
  Search, 
  History, 
  Plus, 
  Trash2, 
  ArrowUp, 
  ArrowDown, 
  Eye, 
  EyeOff, 
  Check, 
  Copy, 
  RefreshCw, 
  Globe, 
  HelpCircle, 
  MessageSquare, 
  CreditCard, 
  Activity, 
  Zap, 
  FileText,
  Sliders,
  Terminal
} from 'lucide-react';
import { cn } from '../../lib/utils';
import confetti from 'canvas-confetti';

interface RealtimeCmsEditorProps {
  website: ClientWebsiteData;
  onUpdateWebsite: (updated: ClientWebsiteData) => void;
  onOpenDeployModal: () => void;
}

type CmsTab = 'blocks' | 'inspector' | 'theme' | 'scaffold' | 'seo' | 'history';

export const RealtimeCmsEditor: React.FC<RealtimeCmsEditorProps> = ({
  website,
  onUpdateWebsite,
  onOpenDeployModal
}) => {
  const [activeTab, setActiveTab] = useState<CmsTab>('blocks');
  const [selectedBlockId, setSelectedBlockId] = useState<string>(website.blocks?.[1]?.id || 'block-hero');
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiScaffolding, setIsAiScaffolding] = useState(false);
  const [snapshotTitle, setSnapshotTitle] = useState('');

  const selectedBlock = website.blocks?.find(b => b.id === selectedBlockId) || website.blocks?.[0];

  // Block management
  const toggleBlock = (id: string) => {
    const updated = website.blocks.map(b => b.id === id ? { ...b, enabled: !b.enabled } : b);
    onUpdateWebsite({ ...website, blocks: updated });
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= website.blocks.length) return;
    const newBlocks = [...website.blocks];
    const [moved] = newBlocks.splice(index, 1);
    newBlocks.splice(targetIndex, 0, moved);
    onUpdateWebsite({ ...website, blocks: newBlocks });
  };

  const deleteBlock = (id: string) => {
    const updated = website.blocks.filter(b => b.id !== id);
    onUpdateWebsite({ ...website, blocks: updated });
    if (selectedBlockId === id) {
      setSelectedBlockId(updated[0]?.id || '');
    }
  };

  const addNewBlock = (type: SiteBlockType) => {
    const newId = 'block-' + Date.now();
    const names: Record<SiteBlockType, string> = {
      navbar: 'Navigation Bar',
      hero: 'Hero Section',
      stats: 'Impact Metrics',
      features: 'Feature Grid',
      bento: 'Bento Grid Deep-Dive',
      pricing: 'Pricing Matrix',
      testimonials: 'Testimonial Carousel',
      faq: 'FAQ Accordion',
      leadCapture: 'Lead Capture Form',
      ctaBanner: 'Call-to-Action Banner',
      footer: 'Footer & Legal'
    };

    const newBlock: SiteBlock = {
      id: newId,
      type,
      name: names[type] || 'New Section',
      enabled: true,
      headline: `Explore our ${names[type]}`,
      subheadline: 'Crafted with autonomous intelligence and real-time CMS synchronization.'
    };

    onUpdateWebsite({
      ...website,
      blocks: [...website.blocks, newBlock]
    });
    setSelectedBlockId(newId);
    setActiveTab('inspector');
    confetti({ particleCount: 25 });
  };

  const updateBlockField = (field: keyof SiteBlock, value: any) => {
    if (!selectedBlock) return;
    const updated = website.blocks.map(b => 
      b.id === selectedBlock.id ? { ...b, [field]: value } : b
    );
    onUpdateWebsite({ ...website, blocks: updated });
  };

  const applyTemplate = (preset: SitePresetTemplate) => {
    onUpdateWebsite({
      ...preset.website,
      id: website.id,
      snapshots: [
        ...(website.snapshots || []),
        {
          id: 'snap-' + Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          title: `Preset Applied: ${preset.name}`,
          siteData: JSON.parse(JSON.stringify(website))
        }
      ]
    });
    confetti({ particleCount: 60, spread: 80 });
  };

  const handleAiScaffold = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setIsAiScaffolding(true);

    setTimeout(() => {
      const lower = aiPrompt.toLowerCase();
      let modified: ClientWebsiteData = JSON.parse(JSON.stringify(website));

      if (lower.includes('fintech') || lower.includes('payment') || lower.includes('banking') || lower.includes('money')) {
        modified = { ...TEMPLATE_FINTECH };
      } else if (lower.includes('agency') || lower.includes('design') || lower.includes('studio') || lower.includes('creative')) {
        modified = { ...TEMPLATE_AGENCY };
      } else {
        modified.title = `${aiPrompt.slice(0, 30)} — Autonomous Solution`;
        modified.heroHeadline = aiPrompt.length > 15 ? `Next-Gen: ${aiPrompt}` : 'The Autonomous Solution for Tomorrow’s Leaders';
        modified.heroSubheadline = 'Engineered with multi-agent orchestration, instant edge deployment, and real-time headless CMS synchronization.';
      }

      onUpdateWebsite(modified);
      setIsAiScaffolding(false);
      setAiPrompt('');
      confetti({ particleCount: 50 });
    }, 1200);
  };

  const takeSnapshot = () => {
    const newSnapshot = {
      id: 'snap-' + Date.now(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      title: snapshotTitle.trim() || `Revision #${(website.snapshots?.length || 0) + 1}`,
      siteData: JSON.parse(JSON.stringify(website))
    };
    onUpdateWebsite({
      ...website,
      snapshots: [newSnapshot, ...(website.snapshots || [])]
    });
    setSnapshotTitle('');
    confetti({ particleCount: 30 });
  };

  const restoreSnapshot = (snap: any) => {
    onUpdateWebsite({
      ...snap.siteData,
      snapshots: website.snapshots
    });
    confetti({ particleCount: 40 });
  };

  const tabs: { id: CmsTab; label: string; icon: any }[] = [
    { id: 'blocks', label: 'Blocks', icon: Layers },
    { id: 'inspector', label: 'Inspector', icon: Sliders },
    { id: 'theme', label: 'Theme', icon: Palette },
    { id: 'scaffold', label: 'AI Scaffold', icon: Sparkles },
    { id: 'seo', label: 'SEO & Domain', icon: Globe },
    { id: 'history', label: 'Revisions', icon: History }
  ];

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
      {/* Top Header Navigation */}
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-1 overflow-x-auto no-scrollbar bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-all",
                activeTab === t.id
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              )}
            >
              <t.icon size={13} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={onOpenDeployModal}
          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm shrink-0"
        >
          <Globe size={13} />
          <span className="hidden sm:inline">Deploy Live</span>
        </button>
      </div>

      {/* Main CMS Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* ================= TAB 1: BLOCKS MANAGER ================= */}
        {activeTab === 'blocks' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Layout Section Blocks</h3>
                <p className="text-zinc-500 text-[11px]">Drag, reorder, enable/disable, or inspect any section</p>
              </div>
            </div>

            {/* Block List */}
            <div className="space-y-1.5">
              {website.blocks.map((block, idx) => (
                <div
                  key={block.id}
                  onClick={() => {
                    setSelectedBlockId(block.id);
                    setActiveTab('inspector');
                  }}
                  className={cn(
                    "p-2.5 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all",
                    selectedBlockId === block.id
                      ? "bg-blue-50/80 dark:bg-blue-950/40 border-blue-500/80 shadow-xs"
                      : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700",
                    !block.enabled && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono text-zinc-400 w-4">{idx + 1}</span>
                    <div className="truncate">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{block.name}</div>
                      <div className="text-[10px] text-zinc-400 uppercase font-mono">{block.type}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => moveBlock(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30"
                      title="Move Up"
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      onClick={() => moveBlock(idx, 'down')}
                      disabled={idx === website.blocks.length - 1}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30"
                      title="Move Down"
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button
                      onClick={() => toggleBlock(block.id)}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      title={block.enabled ? "Hide block" : "Show block"}
                    >
                      {block.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button
                      onClick={() => deleteBlock(block.id)}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950 text-red-500"
                      title="Delete block"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Block Selector */}
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-2">
                + Add Section to Landing Page
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button
                  onClick={() => addNewBlock('bento')}
                  className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-left border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="font-bold text-[11px]">Bento Grid</div>
                  <div className="text-[10px] text-zinc-400">Deep architecture</div>
                </button>
                <button
                  onClick={() => addNewBlock('stats')}
                  className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-left border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="font-bold text-[11px]">Stats / ROI</div>
                  <div className="text-[10px] text-zinc-400">Numeric metrics</div>
                </button>
                <button
                  onClick={() => addNewBlock('pricing')}
                  className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-left border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="font-bold text-[11px]">Pricing Plans</div>
                  <div className="text-[10px] text-zinc-400">Tier calculator</div>
                </button>
                <button
                  onClick={() => addNewBlock('testimonials')}
                  className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-left border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="font-bold text-[11px]">Testimonials</div>
                  <div className="text-[10px] text-zinc-400">Social proof cards</div>
                </button>
                <button
                  onClick={() => addNewBlock('faq')}
                  className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-left border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="font-bold text-[11px]">FAQ Accordion</div>
                  <div className="text-[10px] text-zinc-400">Collapsible Q&A</div>
                </button>
                <button
                  onClick={() => addNewBlock('leadCapture')}
                  className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-left border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="font-bold text-[11px]">Lead Form</div>
                  <div className="text-[10px] text-zinc-400">Email intake</div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 2: FIELD INSPECTOR ================= */}
        {activeTab === 'inspector' && selectedBlock && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-zinc-100">
                  Editing Section: {selectedBlock.name}
                </h3>
                <span className="text-[10px] font-mono text-zinc-400">ID: {selectedBlock.id}</span>
              </div>
              <button
                onClick={() => setActiveTab('blocks')}
                className="text-[11px] text-blue-500 font-semibold hover:underline"
              >
                Back to blocks
              </button>
            </div>

            <div className="space-y-3">
              {/* Section Headline */}
              <div>
                <label className="text-[11px] text-zinc-400 font-medium">Section Headline</label>
                <input
                  type="text"
                  value={selectedBlock.headline || ''}
                  onChange={(e) => updateBlockField('headline', e.target.value)}
                  placeholder="Enter headline..."
                  className="w-full mt-1 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Section Subheadline */}
              <div>
                <label className="text-[11px] text-zinc-400 font-medium">Section Subheadline / Description</label>
                <textarea
                  rows={2}
                  value={selectedBlock.subheadline || ''}
                  onChange={(e) => updateBlockField('subheadline', e.target.value)}
                  placeholder="Enter subheadline..."
                  className="w-full mt-1 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Section Badge */}
              <div>
                <label className="text-[11px] text-zinc-400 font-medium">Eyebrow Badge Text</label>
                <input
                  type="text"
                  value={selectedBlock.badge || ''}
                  onChange={(e) => updateBlockField('badge', e.target.value)}
                  placeholder="e.g. Next-Generation AI"
                  className="w-full mt-1 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Specific inspector controls for Hero */}
              {selectedBlock.type === 'hero' && (
                <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  <h4 className="font-bold text-[11px] text-zinc-400 uppercase">Call to Action Buttons</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-400">Primary CTA Text</label>
                      <input
                        type="text"
                        value={website.primaryCta}
                        onChange={(e) => onUpdateWebsite({ ...website, primaryCta: e.target.value })}
                        className="w-full mt-0.5 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400">Secondary CTA Text</label>
                      <input
                        type="text"
                        value={website.secondaryCta}
                        onChange={(e) => onUpdateWebsite({ ...website, secondaryCta: e.target.value })}
                        className="w-full mt-0.5 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= TAB 3: THEME & STYLING ================= */}
        {activeTab === 'theme' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Design System & Colors</h3>
              <p className="text-zinc-500 text-[11px]">Configure brand tokens, palettes, typography, and edge container geometry.</p>
            </div>

            {/* Color Swatches */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-zinc-400">Brand Primary Accent</label>
              <div className="flex items-center gap-2">
                {['#2563eb', '#10b981', '#8b5cf6', '#d97706', '#ec4899', '#06b6d4'].map((col) => (
                  <button
                    key={col}
                    onClick={() => {
                      onUpdateWebsite({
                        ...website,
                        accentColor: col,
                        theme: { ...website.theme, primaryColor: col }
                      });
                    }}
                    className={cn(
                      "w-8 h-8 rounded-full shadow-sm flex items-center justify-center transition-transform hover:scale-110",
                      website.accentColor === col ? "ring-2 ring-offset-2 ring-white scale-110" : ""
                    )}
                    style={{ backgroundColor: col }}
                  >
                    {website.accentColor === col && <Check size={14} className="text-white" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Background Atmosphere */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-zinc-400">Canvas Atmosphere Mode</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'dark', label: 'Carbon Dark', desc: 'Minimalist Zinc #09090b' },
                  { id: 'midnight', label: 'Deep Midnight', desc: 'Slate Blue #020617' },
                  { id: 'light', label: 'Crisp Light', desc: 'High-contrast White #ffffff' },
                  { id: 'mesh', label: 'Radiant Mesh', desc: 'Indigo gradient aura' }
                ].map((bg) => (
                  <button
                    key={bg.id}
                    onClick={() => {
                      onUpdateWebsite({
                        ...website,
                        theme: { ...website.theme, backgroundTheme: bg.id as any }
                      });
                    }}
                    className={cn(
                      "p-2.5 rounded-xl text-left border transition-all",
                      website.theme?.backgroundTheme === bg.id
                        ? "bg-blue-50/80 dark:bg-blue-950/50 border-blue-500 font-semibold"
                        : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                    )}
                  >
                    <div className="text-xs">{bg.label}</div>
                    <div className="text-[10px] text-zinc-400">{bg.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Typography Pairing */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-zinc-400">Typography Scale</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'sans', label: 'Modern Sans', preview: 'Inter / Plus' },
                  { id: 'serif', label: 'Editorial Serif', preview: 'Playfair / Times' },
                  { id: 'mono', label: 'Developer Mono', preview: 'JetBrains Code' }
                ].map((font) => (
                  <button
                    key={font.id}
                    onClick={() => {
                      onUpdateWebsite({
                        ...website,
                        theme: { ...website.theme, fontFamily: font.id as any }
                      });
                    }}
                    className={cn(
                      "p-2 rounded-xl text-center border transition-all",
                      website.theme?.fontFamily === font.id
                        ? "bg-blue-50/80 dark:bg-blue-950/50 border-blue-500 font-semibold"
                        : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                    )}
                  >
                    <div className="text-xs">{font.label}</div>
                    <div className="text-[10px] text-zinc-400">{font.preview}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 4: AI SCAFFOLD & PRESETS ================= */}
        {activeTab === 'scaffold' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-zinc-900 dark:text-zinc-100">AI Scaffolder & Site Presets</h3>
              <p className="text-zinc-500 text-[11px]">Generate complete landing experiences with one prompt or click a pre-built archetype.</p>
            </div>

            {/* AI Prompt Input */}
            <form onSubmit={handleAiScaffold} className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-500">
                <Sparkles size={13} />
                <span>Natural Language Site Scaffolder</span>
              </div>
              <textarea
                rows={2}
                placeholder="Describe your site (e.g., 'A cybersecurity platform with compliance badges, 3 pricing tiers, and deep midnight theme')..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="w-full p-2 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={isAiScaffolding || !aiPrompt.trim()}
                className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-1.5 transition-all"
              >
                {isAiScaffolding ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
                <span>{isAiScaffolding ? 'Synthesizing AST & Blocks...' : 'Scaffold Site with Agent Sam'}</span>
              </button>
            </form>

            {/* 1-Click Industry Templates */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block">
                Production-Tested Archetypes
              </label>
              <div className="space-y-2">
                {SITE_PRESET_TEMPLATES.map((preset) => (
                  <div
                    key={preset.id}
                    className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center justify-between gap-3 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100">{preset.name}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-blue-500/10 text-blue-500 font-bold">
                          {preset.badge}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-400 truncate">{preset.description}</p>
                    </div>

                    <button
                      onClick={() => applyTemplate(preset)}
                      className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 text-white dark:text-zinc-900 text-[11px] font-semibold shrink-0 active:scale-95 transition-all"
                    >
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 5: SEO & DOMAIN ================= */}
        {activeTab === 'seo' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-zinc-900 dark:text-zinc-100">SEO, Metadata & Custom Domains</h3>
              <p className="text-zinc-500 text-[11px]">Configure search engine meta tags and custom edge domain mapping.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-zinc-400 font-medium">Page Meta Title</label>
                <input
                  type="text"
                  value={website.seo?.metaTitle || website.title}
                  onChange={(e) => onUpdateWebsite({
                    ...website,
                    seo: { ...website.seo, metaTitle: e.target.value }
                  })}
                  className="w-full mt-1 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] text-zinc-400 font-medium">Meta Description</label>
                <textarea
                  rows={2}
                  value={website.seo?.metaDescription || website.heroSubheadline}
                  onChange={(e) => onUpdateWebsite({
                    ...website,
                    seo: { ...website.seo, metaDescription: e.target.value }
                  })}
                  className="w-full mt-1 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none"
                />
              </div>

              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
                <label className="text-[11px] text-zinc-400 font-medium">Custom Subdomain</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={website.deployment?.subdomain || 'preview'}
                    onChange={(e) => onUpdateWebsite({
                      ...website,
                      deployment: { ...website.deployment, subdomain: e.target.value }
                    })}
                    className="flex-1 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none font-mono"
                  />
                  <span className="text-zinc-400 font-mono text-[11px]">.apexdynamics.ai</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 6: REVISIONS & SNAPSHOTS ================= */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-zinc-900 dark:text-zinc-100">Revision History & Rollbacks</h3>
              <p className="text-zinc-500 text-[11px]">Save snapshots and roll back any CMS change with zero risk.</p>
            </div>

            {/* Create Snapshot */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Snapshot label (e.g. 'Pre-launch hero copy')..."
                value={snapshotTitle}
                onChange={(e) => setSnapshotTitle(e.target.value)}
                className="flex-1 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none"
              />
              <button
                onClick={takeSnapshot}
                className="px-3.5 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold shrink-0 shadow-xs active:scale-95 transition-all"
              >
                Save Version
              </button>
            </div>

            {/* Timeline */}
            <div className="space-y-2 pt-2">
              {website.snapshots && website.snapshots.length > 0 ? (
                website.snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">{snap.title}</div>
                      <div className="text-[10px] text-zinc-400">{snap.timestamp}</div>
                    </div>
                    <button
                      onClick={() => restoreSnapshot(snap)}
                      className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold"
                    >
                      Restore
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-zinc-400 text-xs">
                  No previous snapshots saved yet. Click "Save Version" to create your first milestone!
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
