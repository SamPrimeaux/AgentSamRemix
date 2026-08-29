import React, { useState, useRef, useEffect } from 'react';
import {
  IAMUser,
  Mission,
  ExecutionEvent,
  ApprovalRequest,
  ImageAttachment,
  ImageAnalysisResult,
} from '../../sdk/types';
import { MissionRuntime } from '../../sdk/mission';
import { MobileImagePickerModal } from './MobileImagePickerModal';
import { ImageInspectionModal } from './ImageInspectionModal';
import { MobileNavDrawer } from '../workbench/MobileNavDrawer';
import { WorkbenchViewTab } from '../WorkbenchApp';
import { analyzeImage } from '../../services/visionService';

interface MobileWorkbenchViewProps {
  user: IAMUser;
  onLogout: () => void;
  selectedRepo: string;
  onSelectRepo: (repo: string) => void;
  activeRef: string;
  events: ExecutionEvent[];
  activeMission: Mission | null;
  isExecuting: boolean;
  onStartMission: (goal?: any) => void;
  onSelectTab: (tab: WorkbenchViewTab) => void;
  onOpenSettings: () => void;
}

export const MobileWorkbenchView: React.FC<MobileWorkbenchViewProps> = ({
  user,
  onLogout,
  selectedRepo,
  activeRef,
  events,
  activeMission,
  isExecuting,
  onStartMission,
  onSelectTab,
}) => {
  // Mobile Display Preferences
  const [mobileMode, setMobileMode] = useState<'timeline' | 'chat'>('timeline');
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(false); // default light as Screenshot 1, toggleable to dark as Screenshot 2
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Image Analysis & Attachment State
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const [inspectedImage, setInspectedImage] = useState<{
    attachment: ImageAttachment;
    analysis: ImageAnalysisResult | null;
  } | null>(null);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [imageAnalyses, setImageAnalyses] = useState<Record<string, ImageAnalysisResult>>({});
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);

  // Chat / Input State
  const [inputPrompt, setInputPrompt] = useState('');
  const [isDiffExpanded, setIsDiffExpanded] = useState(true);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Active step index simulation for realistic timeline
  const [timelineStep, setTimelineStep] = useState(4); // "Running tests... 2/5"

  // Context chips
  const [contextTags, setContextTags] = useState<string[]>([
    'GitHub inneranimalmedia',
    'main',
    'Context',
  ]);

  const handleAttachImage = async (attachment: ImageAttachment) => {
    setAttachedImages(prev => [...prev, attachment]);
    setIsAnalyzingImage(true);

    try {
      // Analyze with Gemini vision
      const result = await analyzeImage(attachment, inputPrompt || 'Classify and inspect engineering artifact', selectedRepo);
      setImageAnalyses(prev => ({ ...prev, [attachment.id]: result }));
      
      // If user hasn't typed anything yet, suggest prompt from vision result
      if (!inputPrompt && result.suggestedMissionPrompt) {
        setInputPrompt(result.suggestedMissionPrompt);
      }
    } catch (err) {
      console.error('Vision analysis error:', err);
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  const handleRemoveImage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAttachedImages(prev => prev.filter(img => img.id !== id));
  };

  const handleSend = () => {
    if (!inputPrompt.trim() && attachedImages.length === 0) return;

    const goal = {
      id: `msn_mobile_${Date.now()}`,
      title: inputPrompt || 'Autonomous visual refactor',
      description: `Mobile mission execution on ${selectedRepo} with ${attachedImages.length} attached visual artifacts`,
      targetRepo: selectedRepo,
      targetBranch: activeRef,
      workingBranch: `agentsam/mobile-refactor-${Math.random().toString(36).slice(2, 7)}`,
      isSelfHosting: selectedRepo.includes('agentsam-sdk'),
      priority: 'high' as const,
      images: attachedImages,
    };

    onStartMission(goal);
    setInputPrompt('');
    setAttachedImages([]);
    setMobileMode('timeline');
  };

  return (
    <div
      className={`min-h-screen w-full flex flex-col font-sans transition-colors duration-200 select-none overflow-x-hidden ${
        isDarkTheme ? 'bg-[#090b10] text-zinc-100' : 'bg-[#f8fafc] text-zinc-900'
      }`}
    >
      {/* 1. Mobile Status Bar & Navigation Bar */}
      <header
        className={`sticky top-0 z-30 px-4 pt-3 pb-2.5 flex items-center justify-between border-b backdrop-blur-md transition-colors ${
          isDarkTheme
            ? 'bg-[#090b10]/90 border-zinc-800/80 text-zinc-100'
            : 'bg-white/90 border-zinc-200/70 text-zinc-900'
        }`}
      >
        {/* Left: Hamburger Drawer Menu */}
        <button
          onClick={() => setIsDrawerOpen(true)}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
            isDarkTheme ? 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
          }`}
          aria-label="Open Navigation Drawer"
        >
          <span className="material-symbols-outlined text-xl">menu</span>
        </button>

        {/* Center: Brand Title + Repo Indicator */}
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-base tracking-tight">Agent Sam</span>
            {isDarkTheme && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>InnerAnimalMedia</span>
              </span>
            )}
          </div>
          {!isDarkTheme && (
            <span className="text-[10px] text-zinc-500 font-mono tracking-tight">Workbench 2.0 • Autonomous</span>
          )}
        </div>

        {/* Right: Mode & Theme Quick Controls */}
        <div className="flex items-center gap-1">
          {/* Mode Switcher: Timeline vs Chat */}
          <button
            onClick={() => setMobileMode(prev => (prev === 'timeline' ? 'chat' : 'timeline'))}
            className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
              mobileMode === 'chat'
                ? 'bg-sky-500 text-white shadow-sm'
                : isDarkTheme
                ? 'bg-zinc-900 border border-zinc-800 text-zinc-300'
                : 'bg-zinc-100 text-zinc-700'
            }`}
            title="Switch View Mode"
          >
            <span className="material-symbols-outlined text-sm">
              {mobileMode === 'timeline' ? 'chat_bubble' : 'timeline'}
            </span>
            <span className="hidden xs:inline">{mobileMode === 'timeline' ? 'Chat' : 'Timeline'}</span>
          </button>

          {/* Theme Switcher: Light (Screenshot 1) vs Dark (Screenshot 2) */}
          <button
            onClick={() => setIsDarkTheme(!isDarkTheme)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
              isDarkTheme ? 'bg-zinc-900 border border-zinc-800 text-amber-400' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
            }`}
            title={isDarkTheme ? 'Switch to Light Spec (Screenshot 1)' : 'Switch to Dark Spec (Screenshot 2)'}
          >
            <span className="material-symbols-outlined text-lg">
              {isDarkTheme ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
        </div>
      </header>

      {/* 2. Subtitle Pills Bar (Repository Badge & Mission Status) */}
      <div className={`px-4 py-2 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar border-b ${isDarkTheme ? 'border-zinc-850 bg-zinc-950/30' : 'border-zinc-100 bg-white/50'}`}>
        <div className="flex items-center gap-1.5">
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border shadow-xs ${
              isDarkTheme
                ? 'bg-zinc-900 border-zinc-800 text-zinc-300'
                : 'bg-white border-zinc-200 text-zinc-800'
            }`}
          >
            <span className="material-symbols-outlined text-sm text-zinc-400">commit</span>
            <span className="font-semibold tracking-tight">inneranimalmedia</span>
            <span className="text-zinc-400">•</span>
            <span className="font-mono text-zinc-500">{activeRef}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Mission active</span>
          </div>
        </div>
      </div>

      {/* 3. Main Scrollable Content Area */}
      <main className="flex-1 px-4 py-4 space-y-4 max-w-lg mx-auto w-full pb-36">
        {/* ========================================================
            MODE A: TIMELINE & EXECUTION SPEC (Matching Screenshot 1)
           ======================================================== */}
        {mobileMode === 'timeline' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Active Mission Card */}
            <div
              className={`p-4 rounded-2xl border shadow-sm transition-all ${
                isDarkTheme
                  ? 'bg-zinc-900/90 border-zinc-800'
                  : 'bg-white border-zinc-200/90'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-xl">rocket_launch</span>
                  </div>
                  <div>
                    <h2 className="font-bold text-sm tracking-tight leading-snug">
                      {activeMission?.goal.title || 'Auth refactor drop-in prep'}
                    </h2>
                    <p className={`text-xs mt-0.5 ${isDarkTheme ? 'text-zinc-400' : 'text-zinc-600'}`}>
                      {activeMission?.goal.description || 'Prepare Agent Sam auth + SDK identity for InnerAnimalMedia workbench.'}
                    </p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-zinc-400 text-lg shrink-0 mt-1">
                  chevron_right
                </span>
              </div>

              {/* Badges in Mission Card Footer */}
              <div className="mt-3.5 pt-3 border-t border-zinc-200/50 dark:border-zinc-800 flex flex-wrap items-center gap-1.5">
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-md font-medium border flex items-center gap-1 ${
                    isDarkTheme
                      ? 'bg-zinc-800 border-zinc-700 text-zinc-300'
                      : 'bg-zinc-100 border-zinc-200 text-zinc-700'
                  }`}
                >
                  <span className="material-symbols-outlined text-xs text-zinc-400">code</span>
                  <span>GitHub • inneranimalmedia</span>
                </span>

                <span
                  className={`text-[11px] px-2 py-0.5 rounded-md font-medium border flex items-center gap-1 ${
                    isDarkTheme
                      ? 'bg-zinc-800 border-zinc-700 text-zinc-300'
                      : 'bg-zinc-100 border-zinc-200 text-zinc-700'
                  }`}
                >
                  <span className="material-symbols-outlined text-xs text-zinc-400">travel_explore</span>
                  <span>Repo intelligence</span>
                </span>
              </div>
            </div>

            {/* Section: Execution Timeline */}
            <div>
              <div className="flex items-center justify-between px-1 mb-2.5">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Execution timeline
                </span>
                <span className="text-[11px] font-mono text-zinc-400">
                  {events.length > 0 ? `${events.length} events logged` : 'Live runtime'}
                </span>
              </div>

              {/* Vertical Timeline Nodes */}
              <div
                className={`p-4 rounded-2xl border shadow-sm divide-y transition-all ${
                  isDarkTheme
                    ? 'bg-zinc-900/90 border-zinc-800 divide-zinc-800'
                    : 'bg-white border-zinc-200/90 divide-zinc-100'
                }`}
              >
                {/* Step 1: Inspected repository */}
                <div className="py-3 first:pt-0 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-base">check</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-zinc-400 text-sm">folder</span>
                        <span className="font-semibold text-xs tracking-tight">Inspected repository</span>
                      </div>
                      <p className="text-[11px] text-zinc-500">Scanned project structure & manifests</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-400">
                    <span className="text-[11px] font-mono">09:34</span>
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </div>
                </div>

                {/* Step 2: Read 6 files */}
                <div className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-base">check</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-zinc-400 text-sm">description</span>
                        <span className="font-semibold text-xs tracking-tight">Read 6 files</span>
                      </div>
                      <p className="text-[11px] text-zinc-500">Parsed auth, SDK & config files</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-400">
                    <span className="text-[11px] font-mono">09:35</span>
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </div>
                </div>

                {/* Step 3: Wired SDK identity routes */}
                <div className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-base">check</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-zinc-400 text-sm">code</span>
                        <span className="font-semibold text-xs tracking-tight">Wired SDK identity routes</span>
                      </div>
                      <p className="text-[11px] text-zinc-500">Updated routes & types</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-400">
                    <span className="text-[11px] font-mono">09:36</span>
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </div>
                </div>

                {/* Step 4: Running tests... (2 / 5) */}
                <div className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-sky-500/10 text-sky-500 border border-sky-500/30 flex items-center justify-center shrink-0 animate-pulse">
                      <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sky-500 text-sm">terminal</span>
                        <span className="font-bold text-xs tracking-tight text-sky-600 dark:text-sky-400">Running tests...</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 font-bold border border-sky-500/20">
                          2 / 5
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500">Validating changes</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-zinc-400">
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </div>
                </div>

                {/* Step 5: Approval needed: push branch */}
                <div className="py-3 last:pb-0 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/30 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-base">verified_user</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs tracking-tight">Approval needed: push branch</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          Pending
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500">Create PR & push auth-refactor</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-zinc-400">
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Agent Sam Insight Card */}
            <div
              className={`p-4 rounded-2xl border shadow-sm relative overflow-hidden transition-all ${
                isDarkTheme
                  ? 'bg-zinc-900/90 border-zinc-800'
                  : 'bg-white border-zinc-200/90'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-sky-500 text-base">auto_awesome</span>
                <h3 className="font-bold text-xs tracking-tight">Agent Sam insight</h3>
              </div>
              <p className={`text-xs leading-relaxed font-medium ${isDarkTheme ? 'text-zinc-300' : 'text-zinc-700'}`}>
                "Next meaningful peel: unify auth authority and remove duplicate session guards."
              </p>

              {/* Watermark Quote Icon */}
              <span className="material-symbols-outlined absolute -bottom-3 -right-2 text-6xl text-zinc-200/30 dark:text-zinc-800/30 pointer-events-none select-none">
                format_quote
              </span>
            </div>
          </div>
        )}

        {/* ========================================================
            MODE B: INTERACTIVE CHAT STREAM (Matching Screenshot 2)
           ======================================================== */}
        {mobileMode === 'chat' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Date Separator Pill */}
            <div className="flex justify-center">
              <div
                className={`px-3 py-1 rounded-full text-[11px] font-medium border shadow-xs flex items-center gap-1 ${
                  isDarkTheme
                    ? 'bg-zinc-900 border-zinc-800 text-zinc-400'
                    : 'bg-white border-zinc-200 text-zinc-600'
                }`}
              >
                <span>Today</span>
                <span className="material-symbols-outlined text-xs">expand_more</span>
              </div>
            </div>

            {/* 1. User Message Bubble */}
            <div className="flex justify-end">
              <div
                className={`max-w-[85%] p-3.5 rounded-2xl rounded-tr-sm shadow-sm ${
                  isDarkTheme
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/60'
                    : 'bg-zinc-900 text-white'
                }`}
              >
                <p className="text-xs leading-relaxed font-medium">
                  Finish the auth peel. Remove any god-tier bypasses and clean up the overlap in src/ and backend.
                </p>
                <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-zinc-400 font-mono">
                  <span>9:41 AM</span>
                  <span className="material-symbols-outlined text-sky-400 text-xs font-bold">done_all</span>
                </div>
              </div>
            </div>

            {/* 2. Agent Sam Message Container */}
            <div className="flex gap-2.5 items-start">
              {/* Agent Avatar */}
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-md">
                S
              </div>

              {/* Agent Message Content */}
              <div className="flex-1 space-y-3">
                {/* Agent Header & Introduction */}
                <div
                  className={`p-3.5 rounded-2xl rounded-tl-sm border shadow-sm ${
                    isDarkTheme
                      ? 'bg-zinc-900 border-zinc-800 text-zinc-200'
                      : 'bg-white border-zinc-200/90 text-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="font-bold text-xs tracking-tight">Agent Sam</span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-400 uppercase">
                      AI
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed">
                    Understood. I'll audit the current auth flow, remove god-tier bypasses, and refactor overlapping logic out of <span className="font-mono font-semibold text-sky-500">src/</span> into <span className="font-mono font-semibold text-sky-500">backend/modules</span>.
                  </p>
                  <p className="text-xs mt-2 font-medium">
                    Here's the plan I'm running: <span className="text-[10px] text-zinc-400 font-mono">9:41 AM</span>
                  </p>

                  {/* Connected Checklist Card */}
                  <div className={`mt-3 p-3 rounded-xl border space-y-2 ${isDarkTheme ? 'bg-black/40 border-zinc-800' : 'bg-zinc-50 border-zinc-200/80'}`}>
                    {/* Item 1 */}
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-emerald-500 text-base">check_circle</span>
                        <span className="font-medium">Scan auth-related files</span>
                      </div>
                      <span className="text-[11px] font-mono text-zinc-500">46 files</span>
                    </div>

                    {/* Item 2 */}
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-emerald-500 text-base">check_circle</span>
                        <span className="font-medium">Identify god-tier bypasses</span>
                      </div>
                      <span className="text-[11px] font-mono text-zinc-500">2 found</span>
                    </div>

                    {/* Item 3 */}
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sky-500 text-base animate-spin">progress_activity</span>
                        <span className="font-semibold text-sky-500">Refactor & move logic</span>
                      </div>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-500 font-bold">
                        In progress
                      </span>
                    </div>

                    {/* Item 4 */}
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-zinc-600 text-base">radio_button_unchecked</span>
                        <span>Run tests</span>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-600">Pending</span>
                    </div>

                    {/* Item 5 */}
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-zinc-600 text-base">radio_button_unchecked</span>
                        <span>Update docs</span>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-600">Pending</span>
                    </div>
                  </div>
                </div>

                {/* Collapsible File Changes Card */}
                <div
                  className={`rounded-2xl border shadow-sm overflow-hidden transition-all ${
                    isDarkTheme
                      ? 'bg-zinc-900 border-zinc-800'
                      : 'bg-white border-zinc-200/90'
                  }`}
                >
                  <div
                    onClick={() => setIsDiffExpanded(!isDiffExpanded)}
                    className="p-3 flex items-center justify-between cursor-pointer hover:bg-zinc-800/20"
                  >
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-zinc-400 text-base">description</span>
                      <span className="font-bold text-xs tracking-tight">Edited 3 files</span>
                    </div>
                    <span className="material-symbols-outlined text-zinc-400 text-base transition-transform duration-200">
                      {isDiffExpanded ? 'expand_less' : 'expand_more'}
                    </span>
                  </div>

                  {isDiffExpanded && (
                    <div className={`p-3 pt-0 border-t space-y-2 font-mono text-xs ${isDarkTheme ? 'border-zinc-800' : 'border-zinc-100'}`}>
                      {/* File 1 */}
                      <div className="flex items-center justify-between py-1 border-b border-zinc-800/40">
                        <span className="text-zinc-300 truncate">backend/auth/guards.js</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-emerald-400 font-bold">+28</span>
                          <span className="text-rose-400 font-bold">-14</span>
                        </div>
                      </div>

                      {/* File 2 */}
                      <div className="flex items-center justify-between py-1 border-b border-zinc-800/40">
                        <span className="text-zinc-300 truncate">backend/auth/policies/bypass.ts</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-emerald-400 font-bold">+12</span>
                          <span className="text-rose-400 font-bold">-33</span>
                        </div>
                      </div>

                      {/* File 3 */}
                      <div className="flex items-center justify-between py-1">
                        <span className="text-zinc-300 truncate">src/core/auth/legacy-bypass.js</span>
                        <span className="text-rose-400 font-bold uppercase text-[10px]">Deleted</span>
                      </div>

                      {/* View Diff Button */}
                      <button
                        onClick={() => onSelectTab('code')}
                        className={`w-full mt-2 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors ${
                          isDarkTheme
                            ? 'border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200'
                            : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-800'
                        }`}
                      >
                        <span className="material-symbols-outlined text-sm">commit</span>
                        <span>GitHub View diff &gt;</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Follow-up Success Message */}
                <div
                  className={`p-3.5 rounded-2xl border shadow-sm ${
                    isDarkTheme
                      ? 'bg-zinc-900 border-zinc-800 text-zinc-200'
                      : 'bg-white border-zinc-200/90 text-zinc-800'
                  }`}
                >
                  <p className="text-xs leading-relaxed font-medium">
                    God-tier bypasses removed. Logic moved to <span className="font-mono text-sky-400">backend/auth</span>. Tests passing.
                  </p>
                  <div className="mt-1 flex items-center justify-end text-[10px] text-zinc-500 font-mono">
                    <span>9:47 AM</span>
                  </div>
                </div>
              </div>
            </div>

            <div ref={chatBottomRef} />
          </div>
        )}
      </main>

      {/* 4. Docked Floating Composer with Multimodal Image Attachment */}
      <footer
        className={`fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-xl transition-colors ${
          isDarkTheme
            ? 'bg-[#090b10]/95 border-zinc-800 text-zinc-100 shadow-2xl'
            : 'bg-white/95 border-zinc-200/90 text-zinc-900 shadow-xl'
        }`}
      >
        {/* Top Handle bar (iOS Pull Indicator) */}
        <div className="w-full flex justify-center pt-1.5 pb-1">
          <div className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        </div>

        {/* Attached Images Tray (if any are uploaded) */}
        {attachedImages.length > 0 && (
          <div className="px-4 py-2 flex items-center gap-2.5 overflow-x-auto no-scrollbar border-b border-zinc-200/40 dark:border-zinc-800">
            {attachedImages.map(img => {
              const analysis = imageAnalyses[img.id];
              return (
                <div
                  key={img.id}
                  onClick={() => setInspectedImage({ attachment: img, analysis: analysis || null })}
                  className={`relative group rounded-xl border p-1 flex items-center gap-2 cursor-pointer shrink-0 transition-transform active:scale-95 ${
                    isDarkTheme ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-50 border-zinc-300'
                  }`}
                >
                  <div className="w-9 h-9 rounded-lg overflow-hidden border border-zinc-700/20 bg-zinc-950 flex items-center justify-center shrink-0">
                    <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <div className="pr-5 max-w-[120px]">
                    <p className="text-[11px] font-semibold truncate">{img.name}</p>
                    {analysis ? (
                      <span className="text-[9px] font-mono text-sky-500 font-bold">
                        {analysis.classification.replace('_', ' ')}
                      </span>
                    ) : (
                      <span className="text-[9px] text-amber-500 font-medium animate-pulse">
                        Scanning...
                      </span>
                    )}
                  </div>
                  <button
                    onClick={e => handleRemoveImage(img.id, e)}
                    className="absolute top-1 right-1 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[10px]"
                    title="Remove Image"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Main Input Row */}
        <div className="px-4 py-2.5 flex items-center gap-2">
          {/* + Attachment Button (Multimodal Image Upload) */}
          <button
            onClick={() => setIsImagePickerOpen(true)}
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${
              attachedImages.length > 0
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/30 ring-2 ring-sky-400/50'
                : isDarkTheme
                ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
            }`}
            title="Attach Image / Screenshot for Agent Sam"
          >
            <span className="material-symbols-outlined text-xl">add</span>
          </button>

          {/* Text Input Field */}
          <div className="flex-1 relative">
            <input
              type="text"
              value={inputPrompt}
              onChange={e => setInputPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder={
                mobileMode === 'timeline'
                  ? 'Ask Agent Sam or start a mission...'
                  : 'Message Agent Sam...'
              }
              className={`w-full pl-4 pr-10 py-2.5 rounded-full text-xs font-medium focus:outline-none transition-all ${
                isDarkTheme
                  ? 'bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:border-sky-500'
                  : 'bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:border-sky-500 focus:bg-white'
              }`}
            />
            {/* Microphone Icon for Voice Prompting */}
            <button
              onClick={() => setInputPrompt('Refactor authentication flow to remove legacy overlap')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-sky-500"
              title="Voice Prompt"
            >
              <span className="material-symbols-outlined text-base">mic</span>
            </button>
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={!inputPrompt.trim() && attachedImages.length === 0}
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white transition-all ${
              inputPrompt.trim() || attachedImages.length > 0
                ? 'bg-sky-500 hover:bg-sky-400 shadow-md shadow-sky-500/25 active:scale-95 cursor-pointer'
                : 'bg-zinc-300 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
            }`}
            aria-label="Send Mission"
          >
            <span className="material-symbols-outlined text-lg">arrow_upward</span>
          </button>
        </div>

        {/* Context Chip Bar (Screenshot 2 Bottom Footer) */}
        {mobileMode === 'chat' && (
          <div className="px-4 pb-2 flex items-center justify-between gap-1 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1.5">
              {contextTags.map((tag, i) => (
                <span
                  key={i}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                    isDarkTheme
                      ? 'bg-zinc-900 border-zinc-800 text-zinc-400'
                      : 'bg-zinc-100 border-zinc-200 text-zinc-600'
                  }`}
                >
                  <span>{tag}</span>
                  <button
                    onClick={() => setContextTags(prev => prev.filter((_, idx) => idx !== i))}
                    className="hover:text-rose-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button className="text-zinc-500 hover:text-zinc-300 p-1">
              <span className="material-symbols-outlined text-sm">expand_less</span>
            </button>
          </div>
        )}

        {/* iOS Home Bar Indicator */}
        <div className="w-full flex justify-center pb-2 pt-1">
          <div className="w-32 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        </div>
      </footer>

      {/* 5. Mobile Modals */}
      <MobileImagePickerModal
        isOpen={isImagePickerOpen}
        onClose={() => setIsImagePickerOpen(false)}
        onImageSelected={handleAttachImage}
        isDarkTheme={isDarkTheme}
      />

      <ImageInspectionModal
        isOpen={!!inspectedImage}
        onClose={() => setInspectedImage(null)}
        attachment={inspectedImage?.attachment || null}
        analysis={inspectedImage?.analysis || null}
        isDarkTheme={isDarkTheme}
        onLaunchMission={prompt => {
          setInputPrompt(prompt);
          setMobileMode('timeline');
        }}
      />

      <MobileNavDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        activeTab="mission"
        onSelectTab={onSelectTab}
        user={user}
        onLogout={onLogout}
        selectedRepo={selectedRepo}
        isDarkTheme={isDarkTheme}
        onToggleTheme={() => setIsDarkTheme(!isDarkTheme)}
      />
    </div>
  );
};
