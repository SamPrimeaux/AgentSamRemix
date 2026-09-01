import React, { useState } from 'react';
import { 
  FileText, 
  Layout, 
  BarChart3, 
  Sparkles, 
  Users, 
  Play, 
  Download, 
  ExternalLink, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Check, 
  TrendingUp, 
  Smartphone, 
  Monitor, 
  Palette, 
  Video, 
  Image as ImageIcon,
  Copy,
  Edit,
  Trash2,
  RefreshCw,
  Eye,
  Sliders,
  Send,
  Globe,
  Code,
  Layers,
  Terminal
} from 'lucide-react';
import { 
  WorkSubTab, 
  PresentationDeck, 
  ClientWebsiteData, 
  DashboardMetric, 
  BrandKitData, 
  CollaboratorAgent,
  SlideItem,
  GeneratedImageItem,
  GeneratedVideoItem
} from '../types';
import { cn } from '../../lib/utils';
import confetti from 'canvas-confetti';
import { LiveWebsiteSandbox } from './LiveWebsiteSandbox';
import { RealtimeCmsEditor } from './RealtimeCmsEditor';
import { DeploymentModal } from './DeploymentModal';
import { AgentSamWorkMode } from './workbench/AgentSamWorkMode';
import { TelemetryDashboard } from './workbench/TelemetryDashboard';
import { TelemetryData } from '../lib/telemetry';

interface WorkModeViewProps {
  subTab?: WorkSubTab;
  onSubTabChange?: (tab: WorkSubTab) => void;
  deck: PresentationDeck;
  onUpdateDeck: (deck: PresentationDeck) => void;
  website: ClientWebsiteData;
  onUpdateWebsite: (website: ClientWebsiteData) => void;
  metrics: DashboardMetric[];
  brandKit: BrandKitData;
  onUpdateBrandKit: (brandKit: BrandKitData) => void;
  collaborators: CollaboratorAgent[];
  telemetryLogs: TelemetryData[];
  onPresentDeck: () => void;
  onOpenTerminal: () => void;
  onDispatchAgentMessage?: (message: string) => void;
}

export const WorkModeView: React.FC<WorkModeViewProps> = ({
  subTab: externalSubTab,
  onSubTabChange,
  deck,
  onUpdateDeck,
  website,
  onUpdateWebsite,
  metrics,
  brandKit,
  onUpdateBrandKit,
  collaborators,
  telemetryLogs,
  onPresentDeck,
  onOpenTerminal,
  onDispatchAgentMessage
}) => {
  const [internalSubTab, setInternalSubTab] = useState<WorkSubTab>('workbench');
  const subTab = externalSubTab !== undefined ? externalSubTab : internalSubTab;
  const setSubTab = onSubTabChange || setInternalSubTab;
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [previewDevice, setPreviewDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [isEditingSlide, setIsEditingSlide] = useState(false);
  const [websiteViewMode, setWebsiteViewMode] = useState<'split' | 'sandbox' | 'cms'>('split');
  const [isInlineEditMode, setIsInlineEditMode] = useState(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoAspect, setVideoAspect] = useState<'16:9' | '9:16'>('16:9');
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const currentSlide = deck.slides[currentSlideIndex] || deck.slides[0];

  // Handle slide edit
  const handleUpdateCurrentSlide = (field: keyof SlideItem, value: any) => {
    const updatedSlides = [...deck.slides];
    updatedSlides[currentSlideIndex] = {
      ...updatedSlides[currentSlideIndex],
      [field]: value
    };
    onUpdateDeck({ ...deck, slides: updatedSlides });
  };

  const handleAddSlide = () => {
    const newSlide: SlideItem = {
      id: 'slide-' + Date.now(),
      badge: 'Strategic Deliverable',
      title: 'New Client Milestones & Execution',
      subtitle: 'Generated via Agent Sam autonomous collaborative planner.',
      bullets: [
        'High-velocity marketing asset synthesis reducing creative latency',
        'Enterprise data compliance with sandboxed execution runtime',
        'Full multi-channel distribution across mobile, web, and presentation deck'
      ],
      metrics: [
        { label: 'Asset Velocity', value: '<5s', trend: 'Instant' },
        { label: 'Client Approval', value: '99%', trend: 'Target' }
      ],
      accentColor: '#2563eb'
    };
    onUpdateDeck({ ...deck, slides: [...deck.slides, newSlide] });
    setCurrentSlideIndex(deck.slides.length);
  };

  const handleDeleteSlide = (idx: number) => {
    if (deck.slides.length <= 1) return;
    const filtered = deck.slides.filter((_, i) => i !== idx);
    onUpdateDeck({ ...deck, slides: filtered });
    if (currentSlideIndex >= filtered.length) {
      setCurrentSlideIndex(filtered.length - 1);
    }
  };

  const handleGenerateImage = () => {
    if (!imagePrompt.trim()) return;
    setIsGeneratingImage(true);
    setTimeout(() => {
      const newImg: GeneratedImageItem = {
        id: 'img-' + Date.now(),
        prompt: imagePrompt.trim(),
        imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
        model: 'gemini-3.1-flash-image-preview',
        aspectRatio: '16:9',
        timestamp: 'Just now',
        tags: ['Client Asset', '1K Render', 'Gemini Flash']
      };
      onUpdateBrandKit({
        ...brandKit,
        generatedImages: [newImg, ...brandKit.generatedImages]
      });
      setIsGeneratingImage(false);
      setImagePrompt('');
      confetti({ particleCount: 40, spread: 60 });
    }, 1200);
  };

  const handleGenerateVideo = () => {
    if (!videoPrompt.trim()) return;
    setIsGeneratingVideo(true);
    setTimeout(() => {
      const newVid: GeneratedVideoItem = {
        id: 'vid-' + Date.now(),
        prompt: videoPrompt.trim(),
        posterUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80',
        videoUrl: videoAspect === '16:9'
          ? 'https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-screens-with-charts-31911-large.mp4'
          : 'https://assets.mixkit.co/videos/preview/mixkit-vertical-animation-of-blue-and-purple-lights-41372-large.mp4',
        aspectRatio: videoAspect,
        duration: '0:08',
        status: 'ready',
        model: 'veo-3.1-fast-generate-preview',
        timestamp: 'Just now'
      };
      onUpdateBrandKit({
        ...brandKit,
        generatedVideos: [newVid, ...brandKit.generatedVideos]
      });
      setIsGeneratingVideo(false);
      setVideoPrompt('');
      confetti({ particleCount: 50, spread: 70 });
    }, 1500);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-zinc-50/50 dark:bg-black select-text">
      {/* If viewing a Studio sub-tab (not Workbench), show a clean minimal context strip */}
      {subTab !== 'workbench' && (
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white/70 dark:bg-zinc-950/70 backdrop-blur-xs shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSubTab('workbench')}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1 transition-colors"
            >
              <ChevronLeft size={13} />
              <span>Workbench</span>
            </button>
            <span className="text-zinc-400 dark:text-zinc-600">/</span>
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 capitalize">
              {subTab === 'presentations' ? 'Presentation Deck' : subTab === 'websites' ? 'Websites & CMS' : subTab === 'dashboards' ? 'Telemetry Dashboards' : subTab === 'brand' ? 'Brand Studio' : subTab === 'telemetry' ? 'Telemetry' : 'Live Collaboration'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenTerminal}
              className="px-2.5 py-1 rounded-lg text-xs font-mono bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <Terminal size={12} className="text-emerald-400" />
              <span>Terminal</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Body */}
      {subTab === 'workbench' ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#09090b]">
          <AgentSamWorkMode
            onDispatchAgentMessage={onDispatchAgentMessage || (() => {})}
            onOpenTerminal={onOpenTerminal}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 select-text">
        {/* ================= TAB 1: PRESENTATIONS ================= */}
        {subTab === 'presentations' && (
          <div className="max-w-4xl mx-auto space-y-4">
            {/* Action Bar */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">{deck.title}</h2>
                <div className="text-xs text-zinc-500 flex items-center gap-2 mt-0.5">
                  <span>Client: <strong className="text-zinc-700 dark:text-zinc-300">{deck.client}</strong></span>
                  <span>•</span>
                  <span>{deck.version}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={onPresentDeck}
                  className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
                >
                  <Play size={13} className="fill-current" />
                  <span>Present Live</span>
                </button>
                <button
                  onClick={() => {
                    confetti({ particleCount: 30 });
                    alert("Presentation deck exported as high-res pitch deck!");
                  }}
                  className="px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Download size={13} />
                  <span>Export</span>
                </button>
              </div>
            </div>

            {/* Slide Viewer Canvas Card */}
            <div className="w-full aspect-[16/10] sm:aspect-[16/9] rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-md p-6 sm:p-8 flex flex-col justify-between relative overflow-hidden transition-all">
              {/* Subtle top accent bar */}
              <div 
                className="absolute top-0 left-0 right-0 h-1.5"
                style={{ backgroundColor: currentSlide.accentColor || '#10b981' }}
              />

              {/* Slide Header */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                    {currentSlide.badge || 'Strategic Deck'}
                  </span>
                  <span className="text-xs font-mono text-zinc-400">
                    Slide {currentSlideIndex + 1} of {deck.slides.length}
                  </span>
                </div>

                <h3 className="text-lg sm:text-2xl font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight leading-tight">
                  {currentSlide.title}
                </h3>
                {currentSlide.subtitle && (
                  <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    {currentSlide.subtitle}
                  </p>
                )}
              </div>

              {/* Slide Body: Bullets or Quote */}
              <div className="my-3 space-y-2">
                {currentSlide.bullets.map((b, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs sm:text-sm text-zinc-700 dark:text-zinc-300">
                    <span 
                      className="w-2 h-2 rounded-full mt-1.5 shrink-0" 
                      style={{ backgroundColor: currentSlide.accentColor || '#10b981' }}
                    />
                    <span>{b}</span>
                  </div>
                ))}

                {currentSlide.quote && (
                  <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/70 border-l-4 border-blue-500 italic text-xs text-zinc-600 dark:text-zinc-300 mt-2">
                    "{currentSlide.quote.text}"
                    <div className="not-italic font-semibold text-[11px] text-zinc-500 mt-1">
                      — {currentSlide.quote.author}
                    </div>
                  </div>
                )}
              </div>

              {/* Slide Metrics Row */}
              {currentSlide.metrics && currentSlide.metrics.length > 0 && (
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  {currentSlide.metrics.map((m, i) => (
                    <div key={i} className="p-2 sm:p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60">
                      <div className="text-[10px] sm:text-xs text-zinc-400 font-medium">{m.label}</div>
                      <div className="text-sm sm:text-lg font-extrabold text-zinc-900 dark:text-zinc-100">{m.value}</div>
                      {m.trend && (
                        <div className="text-[10px] text-emerald-500 font-semibold">{m.trend}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Slide Thumbnails & Carousel Controls */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 py-1">
                {deck.slides.map((s, idx) => (
                  <button
                    key={s.id}
                    onClick={() => setCurrentSlideIndex(idx)}
                    className={cn(
                      "px-3 py-2 rounded-xl text-xs font-semibold text-left transition-all shrink-0 border",
                      currentSlideIndex === idx
                        ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-white shadow-xs"
                        : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    )}
                  >
                    <div className="text-[10px] opacity-70">Slide {idx + 1}</div>
                    <div className="truncate max-w-[120px]">{s.title}</div>
                  </button>
                ))}
                
                <button
                  onClick={handleAddSlide}
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-blue-600 dark:text-blue-400 border border-dashed border-zinc-300 dark:border-zinc-700 flex items-center gap-1 shrink-0 transition-colors"
                >
                  <Plus size={13} />
                  <span>Add Slide</span>
                </button>
              </div>

              {/* Prev / Next controls */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1))}
                  disabled={currentSlideIndex === 0}
                  className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-300 disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setCurrentSlideIndex(Math.min(deck.slides.length - 1, currentSlideIndex + 1))}
                  disabled={currentSlideIndex === deck.slides.length - 1}
                  className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-300 disabled:opacity-40"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Slide Quick Editor */}
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Edit size={13} className="text-blue-500" />
                  <span>Live Slide Editor (Slide {currentSlideIndex + 1})</span>
                </div>
                <button
                  onClick={() => handleDeleteSlide(currentSlideIndex)}
                  className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1"
                >
                  <Trash2 size={12} />
                  <span>Delete</span>
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-[11px] text-zinc-400 font-medium">Slide Headline</label>
                  <input
                    type="text"
                    value={currentSlide.title}
                    onChange={(e) => handleUpdateCurrentSlide('title', e.target.value)}
                    className="w-full mt-1 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-zinc-400 font-medium">Subtitle / Narrative</label>
                  <input
                    type="text"
                    value={currentSlide.subtitle || ''}
                    onChange={(e) => handleUpdateCurrentSlide('subtitle', e.target.value)}
                    className="w-full mt-1 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 2: CLIENT WEBSITES (CMS & SANDBOX) ================= */}
        {subTab === 'websites' && (
          <div className="w-full flex-1 flex flex-col space-y-3 min-h-[750px]">
            {/* Top Studio Control Bar */}
            <div className="flex items-center justify-between flex-wrap gap-2 px-1">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 flex items-center text-xs font-semibold">
                  <button
                    onClick={() => setWebsiteViewMode('split')}
                    className={cn(
                      "px-3 py-1 rounded-lg flex items-center gap-1.5 transition-all",
                      websiteViewMode === 'split' ? "bg-white dark:bg-zinc-900 shadow-xs text-zinc-900 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                    )}
                  >
                    <Sliders size={13} />
                    <span className="hidden sm:inline">Split Studio</span>
                  </button>
                  <button
                    onClick={() => setWebsiteViewMode('sandbox')}
                    className={cn(
                      "px-3 py-1 rounded-lg flex items-center gap-1.5 transition-all",
                      websiteViewMode === 'sandbox' ? "bg-white dark:bg-zinc-900 shadow-xs text-zinc-900 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                    )}
                  >
                    <Monitor size={13} />
                    <span>Live Preview</span>
                  </button>
                  <button
                    onClick={() => setWebsiteViewMode('cms')}
                    className={cn(
                      "px-3 py-1 rounded-lg flex items-center gap-1.5 transition-all",
                      websiteViewMode === 'cms' ? "bg-white dark:bg-zinc-900 shadow-xs text-zinc-900 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                    )}
                  >
                    <Layers size={13} />
                    <span>CMS Engine</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-[11px] font-mono text-zinc-400 hidden md:flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Edge CDN: Live Sync Active</span>
                </div>

                <button
                  onClick={() => setIsDeployModalOpen(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
                >
                  <Globe size={13} />
                  <span>Edge Deploy Hub</span>
                </button>
              </div>
            </div>

            {/* Layout Canvas: Split, Sandbox, or CMS */}
            <div className="flex-1 w-full grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-[700px]">
              {/* Left/Main Column: Live Website Sandbox */}
              {(websiteViewMode === 'split' || websiteViewMode === 'sandbox') && (
                <div className={cn(
                  "h-full flex flex-col transition-all",
                  websiteViewMode === 'split' ? "lg:col-span-7 xl:col-span-8" : "lg:col-span-12"
                )}>
                  <LiveWebsiteSandbox
                    website={website}
                    onUpdateWebsite={onUpdateWebsite}
                    isInlineEditMode={isInlineEditMode}
                    onToggleInlineEdit={() => setIsInlineEditMode(!isInlineEditMode)}
                    onOpenDeployModal={() => setIsDeployModalOpen(true)}
                  />
                </div>
              )}

              {/* Right Column: Real-time CMS Editor */}
              {(websiteViewMode === 'split' || websiteViewMode === 'cms') && (
                <div className={cn(
                  "h-full flex flex-col transition-all min-h-[500px]",
                  websiteViewMode === 'split' ? "lg:col-span-5 xl:col-span-4" : "lg:col-span-12"
                )}>
                  <RealtimeCmsEditor
                    website={website}
                    onUpdateWebsite={onUpdateWebsite}
                    onOpenDeployModal={() => setIsDeployModalOpen(true)}
                  />
                </div>
              )}
            </div>

            {/* Global Deployment Modal */}
            <DeploymentModal
              isOpen={isDeployModalOpen}
              onClose={() => setIsDeployModalOpen(false)}
              website={website}
              onUpdateWebsite={onUpdateWebsite}
            />
          </div>
        )}

        {/* ================= TAB 3: DASHBOARDS ================= */}
        {subTab === 'dashboards' && (
          <div className="max-w-4xl mx-auto space-y-4">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Executive Operations & Telemetry</h2>
              <p className="text-xs text-zinc-500">Live ROI, Conversion funnels, and Agent Sam execution metrics</p>
            </div>

            {/* Top KPI Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {metrics.map((m) => (
                <div key={m.id} className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-1">
                  <div className="text-[11px] text-zinc-400 font-medium">{m.label}</div>
                  <div className="text-lg sm:text-2xl font-extrabold text-zinc-900 dark:text-zinc-100">{m.value}</div>
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-500">
                    <TrendingUp size={12} />
                    <span>{m.change}</span>
                  </div>
                  <div className="text-[10px] text-zinc-400">{m.timeframe}</div>
                </div>
              ))}
            </div>

            {/* Live Visual Chart Box */}
            <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">Revenue & Lead Conversion Trajectory</h3>
                  <p className="text-xs text-zinc-400">Quarterly growth trajectory with autonomous agent pipeline</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl">
                  <span className="px-2.5 py-0.5 rounded-lg bg-white dark:bg-zinc-900 font-semibold shadow-xs">Q4 2026</span>
                  <span className="px-2 py-0.5 text-zinc-400">YTD</span>
                </div>
              </div>

              {/* Simulated Chart Bars */}
              <div className="h-44 flex items-end justify-between gap-2 pt-4 px-2">
                {[
                  { month: 'Oct W1', rev: 45, agents: 12 },
                  { month: 'Oct W3', rev: 58, agents: 18 },
                  { month: 'Nov W1', rev: 68, agents: 24 },
                  { month: 'Nov W3', rev: 78, agents: 32 },
                  { month: 'Dec W1', rev: 92, agents: 45 },
                  { month: 'Dec W3', rev: 110, agents: 60 },
                  { month: 'Jan Live', rev: 138, agents: 84 },
                ].map((col, idx) => (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                    <div className="text-[10px] font-mono text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      ${col.rev}k
                    </div>
                    <div 
                      className="w-full max-w-[36px] bg-gradient-to-t from-blue-600 to-emerald-400 rounded-t-xl group-hover:brightness-110 transition-all shadow-sm"
                      style={{ height: `${(col.rev / 140) * 100}%` }}
                    />
                    <div className="text-[10px] font-medium text-zinc-400 text-center truncate w-full">
                      {col.month}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 4: BRAND IDENTITY STUDIO ================= */}
        {subTab === 'brand' && (
          <div className="max-w-4xl mx-auto space-y-5">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Brand Identity & Visual Generation Studio</h2>
              <p className="text-xs text-zinc-500">Generate 1K brand mockups with Gemini Flash and 1080p motion teasers with Veo</p>
            </div>

            {/* Brand Colors Swatches */}
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Core Color Tokens & Swatches</div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {[
                  { name: 'Primary Carbon', hex: brandKit.primaryColor },
                  { name: 'Electric Blue', hex: brandKit.secondaryColor },
                  { name: 'Emerald Pulse', hex: brandKit.accentColor },
                  { name: 'Neutral Dark', hex: brandKit.neutralDark },
                  { name: 'Neutral Light', hex: brandKit.neutralLight },
                ].map((c, i) => (
                  <div key={i} className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-lg shadow-sm border border-black/10 shrink-0" style={{ backgroundColor: c.hex }} />
                    <div className="min-w-0">
                      <div className="font-semibold truncate text-[11px]">{c.name}</div>
                      <div className="font-mono text-[10px] text-zinc-400">{c.hex}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Gemini Flash 1K Image Generator */}
            <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-950 text-violet-600 dark:text-violet-400 flex items-center justify-center font-bold">
                    <ImageIcon size={16} />
                  </div>
                  <div>
                    <h3 className="font-bold text-xs text-zinc-900 dark:text-zinc-100">Create & Edit Images (gemini-3.1-flash-image-preview)</h3>
                    <p className="text-[11px] text-zinc-400">Generate 1K brand assets, billboards, and showroom mockups</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="e.g. Futuristic architectural flagship showroom with illuminated holographic brand display..."
                  className="flex-1 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400"
                />
                <button
                  onClick={handleGenerateImage}
                  disabled={!imagePrompt.trim() || isGeneratingImage}
                  className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 shrink-0"
                >
                  <Sparkles size={13} />
                  <span>{isGeneratingImage ? 'Rendering...' : 'Generate 1K'}</span>
                </button>
              </div>

              {/* Gallery */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                {brandKit.generatedImages.map((img) => (
                  <div key={img.id} className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 group relative">
                    <img 
                      src={img.imageUrl} 
                      alt={img.prompt} 
                      className="w-full aspect-[16/10] object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="p-2.5 space-y-1">
                      <div className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200 line-clamp-2">{img.prompt}</div>
                      <div className="flex items-center justify-between text-[10px] text-zinc-400">
                        <span>{img.model}</span>
                        <span>{img.aspectRatio}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Veo Video Generator */}
            <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                    <Video size={16} />
                  </div>
                  <div>
                    <h3 className="font-bold text-xs text-zinc-900 dark:text-zinc-100">Animate Images into Video (veo-3.1-fast-generate-preview)</h3>
                    <p className="text-[11px] text-zinc-400">Generate 16:9 landscape or 9:16 portrait video motion trailers</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    placeholder="e.g. Cinematic camera flythrough of obsidian glass monolith with emerald pulses..."
                    className="flex-1 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400"
                  />
                  <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl shrink-0">
                    <button
                      onClick={() => setVideoAspect('16:9')}
                      className={cn(
                        "px-2 py-1 rounded-lg text-xs font-semibold",
                        videoAspect === '16:9' ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs" : "text-zinc-400"
                      )}
                    >
                      16:9
                    </button>
                    <button
                      onClick={() => setVideoAspect('9:16')}
                      className={cn(
                        "px-2 py-1 rounded-lg text-xs font-semibold",
                        videoAspect === '9:16' ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs" : "text-zinc-400"
                      )}
                    >
                      9:16
                    </button>
                  </div>
                  <button
                    onClick={handleGenerateVideo}
                    disabled={!videoPrompt.trim() || isGeneratingVideo}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 shrink-0"
                  >
                    <Video size={13} />
                    <span>{isGeneratingVideo ? 'Rendering Veo...' : 'Generate Veo'}</span>
                  </button>
                </div>
              </div>

              {/* Video Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {brandKit.generatedVideos.map((vid) => (
                  <div key={vid.id} className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 space-y-2">
                    <div className="relative aspect-[16/9] bg-black">
                      <video
                        src={vid.videoUrl}
                        poster={vid.posterUrl}
                        controls
                        playsInline
                        loop
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-3 text-xs text-white space-y-1">
                      <div className="font-semibold line-clamp-2">{vid.prompt}</div>
                      <div className="flex items-center justify-between text-[10px] text-zinc-400">
                        <span>{vid.model}</span>
                        <span>{vid.aspectRatio} • {vid.duration}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {subTab === 'telemetry' && (
          <div className="max-w-4xl mx-auto space-y-4">
            <TelemetryDashboard logs={telemetryLogs} />
          </div>
        )}

        {/* ================= TAB 5: TEAM LIVE COLLAB ================= */}
        {subTab === 'team' && (
          <div className="max-w-4xl mx-auto space-y-4">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Live Agent Collaboration Workspace</h2>
              <p className="text-xs text-zinc-500">Autonomous agents co-authoring client presentations, websites, and brand collateral</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {collaborators.map((agent) => (
                <div key={agent.id} className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs flex items-start gap-3">
                  <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0", agent.color)}>
                    {agent.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{agent.name}</span>
                      <span className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                        agent.status === 'executing' ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                      )}>
                        {agent.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{agent.role}</div>
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-2 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 font-mono">
                      {agent.currentAction}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
};
