import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  Send, 
  ArrowUp, 
  Mic, 
  MicOff, 
  Sparkles, 
  Terminal, 
  Folder, 
  GitBranch, 
  ChevronDown, 
  Check, 
  FileText, 
  Layout, 
  Image as ImageIcon, 
  Video, 
  BarChart3, 
  CheckCircle2,
  Server,
  Zap,
  Paperclip,
  X,
  Bot
} from 'lucide-react';
import { ModelChoice } from '../../types';
import { useWorkModeConfig } from '../../context/WorkModeConfigContext';
import { cn } from '../../../lib/utils';

export interface UnifiedAgentComposerProps {
  onSendMessage: (text: string, model: ModelChoice) => void;
  isProcessing?: boolean;
  selectedModel?: ModelChoice;
  onSelectModel?: (model: ModelChoice) => void;
  onOpenTerminal?: () => void;
  placeholder?: string;
  className?: string;
  activeBranch?: string;
  activePath?: string;
  onBranchChange?: (branch: string) => void;
  onPathChange?: (path: string) => void;
  showContextPills?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
}

export const UnifiedAgentComposer: React.FC<UnifiedAgentComposerProps> = ({
  onSendMessage,
  isProcessing = false,
  selectedModel: propsModel,
  onSelectModel: propsOnSelectModel,
  onOpenTerminal,
  placeholder = "Message Agent Sam or ask to build...",
  className,
  activeBranch: propsBranch,
  activePath: propsPath,
  onBranchChange,
  onPathChange,
  showContextPills = true,
  compact = false,
  autoFocus = false
}) => {
  const { config, setActiveBranch, setActivePath } = useWorkModeConfig();
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [localModel, setLocalModel] = useState<ModelChoice>(propsModel || (config.defaultModel as ModelChoice) || 'gemini-3.5-flash');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const quickMenuRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  const activeBranch = propsBranch || config.defaultBranch;
  const activePath = propsPath || config.defaultPath;
  const currentModel = propsModel || localModel;

  const handleModelChange = (model: ModelChoice) => {
    if (propsOnSelectModel) {
      propsOnSelectModel(model);
    } else {
      setLocalModel(model);
    }
    setShowModelPicker(false);
  };

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (quickMenuRef.current && !quickMenuRef.current.contains(e.target as Node)) {
        setShowQuickMenu(false);
      }
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Adjust textarea height on change
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = Math.min(Math.max(scrollHeight, 24), 160) + 'px';
    }
  }, [inputText]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isProcessing) return;
    onSendMessage(inputText.trim(), currentModel);
    setInputText('');
    setShowQuickMenu(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleVoiceToggle = () => {
    if (isRecording) {
      setIsRecording(false);
    } else {
      setIsRecording(true);
      const voicePrompts = [
        `Synthesize a 4-slide enterprise pitch deck for ${config.clientBrandName} with Q4 financial roadmap.`,
        "Run the workspace auth test suite and fix all failures.",
        `Build a responsive client landing page with hero, bento grid, and pricing tiers for ${config.clientBrandName}.`,
        `Generate 1K brand assets using gemini-3.1-flash-image for ${config.clientBrandName} flagship showroom.`,
        "Animate a 16:9 cinematic brand trailer using veo-3.1-fast-generate-preview."
      ];
      const randomPrompt = voicePrompts[Math.floor(Math.random() * voicePrompts.length)];
      setTimeout(() => {
        setInputText(randomPrompt);
        setIsRecording(false);
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 1200);
    }
  };

  const quickActionPresets = [
    {
      id: 'deck',
      category: 'Presentations',
      title: 'Synthesize Pitch Deck',
      desc: '4 high-converting slides with ROI models',
      icon: FileText,
      iconColor: 'text-blue-500 bg-blue-500/10',
      prompt: `Synthesize a 4-slide enterprise pitch deck for ${config.clientBrandName} with Q4 financial roadmap and 4.2x ROI.`
    },
    {
      id: 'site',
      category: 'Websites & CMS',
      title: 'Scaffold Landing Page',
      desc: 'Hero, feature matrix & pricing blocks',
      icon: Layout,
      iconColor: 'text-emerald-500 bg-emerald-500/10',
      prompt: `Build a high-converting client landing page for ${config.clientBrandName} with responsive hero, value propositions, and enterprise pricing.`
    },
    {
      id: 'tests',
      category: 'Execution Lane',
      title: 'Run Auth Test Suite',
      desc: 'Execute 18/18 assertion test suite',
      icon: Terminal,
      iconColor: 'text-purple-500 bg-purple-500/10',
      prompt: 'Run the auth tests and fix any failures on the local execution lane.'
    },
    {
      id: 'brand',
      category: 'Brand Studio',
      title: 'Generate 1K Brand Renders',
      desc: 'High-res studio showroom visual assets',
      icon: ImageIcon,
      iconColor: 'text-amber-500 bg-amber-500/10',
      prompt: `Generate 1K brand assets using gemini-3.1-flash-image for ${config.clientBrandName} futuristic flagship showroom.`
    },
    {
      id: 'video',
      category: 'Motion & Video',
      title: 'Cinematic Veo Video',
      desc: '16:9 1080p motion teaser preview',
      icon: Video,
      iconColor: 'text-rose-500 bg-rose-500/10',
      prompt: `Animate a 16:9 cinematic brand motion trailer for ${config.clientBrandName} using veo-3.1-fast-generate-preview.`
    },
    {
      id: 'metrics',
      category: 'Telemetry',
      title: 'Executive KPI Dashboard',
      desc: 'Real-time ROAS, pipeline & agent latency',
      icon: BarChart3,
      iconColor: 'text-cyan-500 bg-cyan-500/10',
      prompt: `Create an executive operations dashboard with revenue metrics and ROAS for ${config.clientBrandName}.`
    }
  ];

  return (
    <div className={cn("w-full relative flex flex-col z-20", className)}>
      {/* 1. Context Selector Header Bar (Model Choice | Git Branch | Path Context) */}
      {showContextPills && (
        <div className="px-3 sm:px-4 py-1.5 flex items-center justify-between gap-2 text-xs overflow-x-auto no-scrollbar border-b border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/40 rounded-t-2xl">
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Model Selector Dropdown Button */}
            <div ref={modelPickerRef} className="relative">
              <button
                type="button"
                onClick={() => setShowModelPicker(!showModelPicker)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/90 dark:border-zinc-700/80 text-zinc-800 dark:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all font-mono text-[11px] shadow-2xs group"
              >
                <Sparkles size={12} className="text-blue-500 group-hover:scale-110 transition-transform" />
                <span className="font-semibold">{currentModel}</span>
                <ChevronDown size={10} className="text-zinc-400" />
              </button>

              {showModelPicker && (
                <div className="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="text-[10px] uppercase font-bold text-zinc-400 px-2 py-1 flex items-center justify-between">
                    <span>Select Gemini Engine</span>
                    <Bot size={11} className="text-zinc-400" />
                  </div>

                  <div className="space-y-1">
                    {[
                      { id: 'gemini-3.7-flash', name: 'gemini-3.7-flash', label: 'Flash 3.7 (Recommended)', desc: 'Fast, intelligent default for all tasks', badge: 'Fast' },
                      { id: 'gemini-3.5-flash', name: 'gemini-3.5-flash', label: 'Flash 3.5', desc: 'Rapid streaming & task traces', badge: 'Standard' },
                      { id: 'gemini-3.1-pro-preview', name: 'gemini-3.1-pro-preview', label: 'Pro 3.1 Reasoning', desc: 'Complex multi-step code & AST reasoning', badge: 'Reasoning' },
                      { id: 'gemini-3.1-flash-lite', name: 'gemini-3.1-flash-lite', label: 'Flash Lite 3.1', desc: 'Ultra-low latency quick tasks', badge: 'Speed' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleModelChange(m.id as ModelChoice)}
                        className={cn(
                          "w-full text-left p-2 rounded-xl text-xs flex items-center justify-between transition-colors",
                          currentModel === m.id
                            ? "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold border border-blue-200 dark:border-blue-800"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                        )}
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span>{m.label}</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-mono">
                              {m.badge}
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-400 mt-0.5">{m.desc}</div>
                        </div>
                        {currentModel === m.id && <Check size={13} className="text-blue-500" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Path Selector */}
            <button
              type="button"
              onClick={() => {
                const nextPath = activePath === 'backend/agentsam' ? 'marketing/campaigns' : 'backend/agentsam';
                if (onPathChange) onPathChange(nextPath);
                setActivePath(nextPath);
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white dark:bg-zinc-800/80 border border-zinc-200/90 dark:border-zinc-700/80 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors font-mono text-[11px] shrink-0"
              title="Switch Workspace Folder"
            >
              <Folder size={11} className="text-amber-500" />
              <span className="truncate max-w-[120px]">{activePath}</span>
            </button>

            {/* Branch Selector */}
            <button
              type="button"
              onClick={() => {
                const nextBranch = activeBranch === 'main' ? 'feature/client-deck' : 'main';
                if (onBranchChange) onBranchChange(nextBranch);
                setActiveBranch(nextBranch);
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white dark:bg-zinc-800/80 border border-zinc-200/90 dark:border-zinc-700/80 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors font-mono text-[11px] shrink-0"
              title="Switch Git Branch"
            >
              <GitBranch size={11} className="text-violet-400" />
              <span>{activeBranch}</span>
            </button>
          </div>

          {/* Quick Terminal Trigger */}
          {onOpenTerminal && (
            <button
              type="button"
              onClick={onOpenTerminal}
              title="Open Terminal Execution Lane (Port 3099)"
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-mono text-zinc-500 hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors shrink-0"
            >
              <Terminal size={11} className="text-emerald-500" />
              <span className="hidden sm:inline">Port {config.execOsPort}</span>
            </button>
          )}
        </div>
      )}

      {/* 2. Quick Action Templates Dropdown / Popover (Triggered by + button) */}
      {showQuickMenu && (
        <div 
          ref={quickMenuRef}
          className="absolute bottom-full left-3 sm:left-4 mb-2 w-80 sm:w-96 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl p-3 z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-100 dark:border-zinc-800">
            <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              <Zap size={13} className="text-amber-500" />
              <span>Autonomous Task Presets</span>
            </div>
            <button
              type="button"
              onClick={() => setShowQuickMenu(false)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-0.5"
            >
              <X size={13} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[320px] overflow-y-auto no-scrollbar">
            {quickActionPresets.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setInputText(item.prompt);
                    setShowQuickMenu(false);
                    if (textareaRef.current) {
                      textareaRef.current.focus();
                    }
                  }}
                  className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-850 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200/60 dark:border-zinc-750 text-left transition-all group flex flex-col justify-between"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center shrink-0", item.iconColor)}>
                      <Icon size={13} />
                    </div>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                      {item.title}
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-400 dark:text-zinc-500 line-clamp-1">
                    {item.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Main Input Box Frame with Textarea & Action Buttons */}
      <div className={cn(
        "relative flex items-end gap-2 p-2.5 sm:p-3 bg-white dark:bg-zinc-950 transition-all",
        showContextPills ? "rounded-b-2xl" : "rounded-2xl",
        "border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs focus-within:ring-2 focus-within:ring-blue-500/40 focus-within:border-blue-500"
      )}>
        {/* + Quick Action Button */}
        <button
          type="button"
          onClick={() => setShowQuickMenu(!showQuickMenu)}
          title="Open Task Action Presets"
          aria-label="Action Presets"
          className={cn(
            "min-w-[44px] min-h-[44px] w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-200 active:scale-95 cursor-pointer touch-manipulation",
            showQuickMenu
              ? "bg-blue-600 text-white rotate-45 shadow-sm"
              : "bg-zinc-100 dark:bg-zinc-850 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          )}
        >
          <Plus size={18} className="stroke-[2.3]" />
        </button>

        {/* Textarea Input Container */}
        <div className="flex-1 min-w-0 relative flex items-center py-1">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isProcessing}
            autoFocus={autoFocus}
            className="w-full bg-transparent border-none outline-none resize-none text-[14px] leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 max-h-40 overflow-y-auto no-scrollbar font-sans"
          />
        </div>

        {/* Action Controls: Mic Dictation + Send Button */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Voice Dictation Button */}
          <button
            type="button"
            onClick={handleVoiceToggle}
            title={isRecording ? "Listening..." : "Dictate prompt"}
            aria-label="Voice input"
            className={cn(
              "min-w-[44px] min-h-[44px] w-11 h-11 rounded-2xl flex items-center justify-center transition-all cursor-pointer active:scale-95 touch-manipulation",
              isRecording
                ? "bg-rose-500 text-white animate-pulse"
                : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            )}
          >
            {isRecording ? <MicOff size={17} /> : <Mic size={17} />}
          </button>

          {/* Send / Execute Button with Lucide Icon */}
          <button
            id="btn-composer-submit"
            type="button"
            onClick={() => handleSubmit()}
            disabled={!inputText.trim() || isProcessing}
            aria-label="Send prompt to agent"
            title="Execute (Enter)"
            className={cn(
              "min-w-[44px] min-h-[44px] w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-150 shadow-xs touch-manipulation",
              inputText.trim() && !isProcessing
                ? "bg-blue-600 hover:bg-blue-500 text-white active:scale-95 shadow-blue-500/20 cursor-pointer"
                : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed"
            )}
          >
            {isProcessing ? (
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            ) : (
              <ArrowUp size={18} className="stroke-[2.5]" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
