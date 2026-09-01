import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  ArrowUp, 
  Mic, 
  MicOff, 
  Sparkles, 
  Terminal, 
  ChevronDown, 
  Check, 
  Paperclip, 
  Bot, 
  Layers, 
  ShieldAlert, 
  FolderPlus, 
  Zap, 
  Cpu,
  X,
  FileCode,
  Globe
} from 'lucide-react';
import { ModelChoice } from '../../types';
import { cn } from '../../../lib/utils';

export interface FlexFitComposerProps {
  onSendMessage: (text: string, model: ModelChoice) => void;
  isProcessing?: boolean;
  selectedModel?: ModelChoice;
  onSelectModel?: (model: ModelChoice) => void;
  onOpenTerminal?: () => void;
  onOpenConnectorDrawer?: () => void;
  placeholder?: string;
  className?: string;
  onWarmAsset?: (assetName: 'monaco' | 'xterm' | 'three' | 'excalidraw') => void;
}

export const FlexFitComposer: React.FC<FlexFitComposerProps> = ({
  onSendMessage,
  isProcessing = false,
  selectedModel: propsModel = 'gemini-3.5-flash',
  onSelectModel,
  onOpenTerminal,
  onOpenConnectorDrawer,
  placeholder = "Work with Agent Sam",
  className,
  onWarmAsset
}) => {
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [currentModel, setCurrentModel] = useState<ModelChoice>(propsModel);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (propsModel) {
      setCurrentModel(propsModel);
    }
  }, [propsModel]);

  // Outside click listener for floating menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setShowPlusMenu(false);
      }
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Textarea auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = Math.min(Math.max(scrollHeight, 24), 140) + 'px';
    }
  }, [inputText]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isProcessing) return;
    onSendMessage(inputText.trim(), currentModel);
    setInputText('');
    setShowPlusMenu(false);
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

  const handleSelectModel = (model: ModelChoice) => {
    setCurrentModel(model);
    if (onSelectModel) {
      onSelectModel(model);
    }
    setShowModelPicker(false);
  };

  const handleVoiceToggle = () => {
    if (isRecording) {
      setIsRecording(false);
    } else {
      setIsRecording(true);
      const voicePrompts = [
        "can you inspect our inneranimalmedia-mcp-server and see if its up to date/not drifting?",
        "Synthesize a 4-slide strategic executive pitch deck for our enterprise client.",
        "Run workspace unit tests and verify terminal operator policy.",
        "Deploy client marketing landing page to production sandbox."
      ];
      const randomPrompt = voicePrompts[Math.floor(Math.random() * voicePrompts.length)];
      setTimeout(() => {
        setInputText(randomPrompt);
        setIsRecording(false);
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 1100);
    }
  };

  return (
    <div className={cn("w-full max-w-4xl mx-auto px-4 relative z-30", className)}>
      {/* Floating Plus Popover Menu */}
      {showPlusMenu && (
        <div 
          ref={plusMenuRef}
          className="absolute bottom-full left-6 mb-3 w-72 rounded-2xl bg-[#1c1c1f] dark:bg-[#18181b] border border-zinc-700/80 dark:border-zinc-800 shadow-2xl p-2 z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 text-white"
        >
          <div className="flex items-center justify-between px-2.5 py-1.5 mb-1 border-b border-zinc-800 text-xs font-semibold text-zinc-400">
            <span>Actions & Connectors</span>
            <button 
              onClick={() => setShowPlusMenu(false)}
              className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded-md"
            >
              <X size={13} />
            </button>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => {
                setInputText("@inneranimalmedia-mcp-server ");
                setShowPlusMenu(false);
                if (textareaRef.current) textareaRef.current.focus();
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-xs flex items-center gap-2.5 hover:bg-zinc-800 transition-colors text-zinc-200"
            >
              <Bot size={14} className="text-purple-400" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">Use plugins</div>
                <div className="text-[10px] text-zinc-500 truncate">MCP tools & agents</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setInputText("Inspect and attach workspace files: ");
                setShowPlusMenu(false);
                if (textareaRef.current) textareaRef.current.focus();
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-xs flex items-center gap-2.5 hover:bg-zinc-800 transition-colors text-zinc-200"
            >
              <Paperclip size={14} className="text-blue-400" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">Attach files or folders</div>
                <div className="text-[10px] text-zinc-500 truncate">Add context to conversation</div>
              </div>
            </button>

            {onOpenConnectorDrawer && (
              <button
                type="button"
                onClick={() => {
                  setShowPlusMenu(false);
                  onOpenConnectorDrawer();
                }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs flex items-center gap-2.5 hover:bg-zinc-800 transition-colors text-zinc-200"
              >
                <Cpu size={14} className="text-amber-400" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">Connect Local Lane (3099)</div>
                  <div className="text-[10px] text-zinc-500 truncate">ExecOS sandbox agent runtime</div>
                </div>
              </button>
            )}

            {onOpenTerminal && (
              <button
                type="button"
                onClick={() => {
                  setShowPlusMenu(false);
                  onOpenTerminal();
                }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs flex items-center gap-2.5 hover:bg-zinc-800 transition-colors text-zinc-200"
              >
                <Terminal size={14} className="text-emerald-400" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">Open Terminal Shell</div>
                  <div className="text-[10px] text-zinc-500 truncate">Inspect test runner & logs</div>
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Floating Model Selector Popover */}
      {showModelPicker && (
        <div 
          ref={modelPickerRef}
          className="absolute bottom-full right-16 mb-3 w-64 rounded-2xl bg-[#1c1c1f] dark:bg-[#18181b] border border-zinc-700/80 dark:border-zinc-800 shadow-2xl p-2 z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 text-white"
        >
          <div className="text-[11px] font-semibold text-zinc-400 px-2 py-1 mb-1 border-b border-zinc-800 flex items-center justify-between">
            <span>Select Model</span>
            <Sparkles size={12} className="text-purple-400" />
          </div>

          <div className="space-y-1">
            {[
              { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash', tag: 'Fast & Clean' },
              { id: 'gemini-3.7-flash', label: 'gemini-3.7-flash', tag: 'Standard' },
              { id: 'gemini-3.1-pro-preview', label: '5.6 Luna Pro / Reasoning', tag: 'Pro' },
              { id: 'gemini-3.1-flash-lite', label: 'Flash Lite 3.1', tag: 'Speed' }
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelectModel(m.id as ModelChoice)}
                className={cn(
                  "w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition-colors",
                  currentModel === m.id
                    ? "bg-purple-900/40 text-purple-200 font-semibold border border-purple-500/30"
                    : "hover:bg-zinc-800 text-zinc-300"
                )}
              >
                <div>
                  <div className="font-medium">{m.label}</div>
                  <div className="text-[10px] text-zinc-500">{m.tag}</div>
                </div>
                {currentModel === m.id && <Check size={13} className="text-purple-400" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Floating FlexFit Composer Capsule */}
      <div className="w-full bg-[#202123]/95 dark:bg-[#18181b]/95 backdrop-blur-2xl border border-zinc-700/60 dark:border-zinc-800/80 shadow-[0_12px_40px_rgba(0,0,0,0.4)] rounded-full sm:rounded-[32px] px-3 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-3 transition-all focus-within:ring-2 focus-within:ring-purple-500/30 focus-within:border-purple-500/50">
        
        {/* Left: Plus Menu Trigger Button */}
        <button
          type="button"
          onClick={() => setShowPlusMenu(!showPlusMenu)}
          aria-label="Add action or plugin"
          className={cn(
            "min-w-[40px] min-h-[40px] w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all text-zinc-400 hover:text-white hover:bg-zinc-700/50 active:scale-95 cursor-pointer touch-manipulation",
            showPlusMenu && "bg-purple-600 text-white rotate-45"
          )}
        >
          <Plus size={18} className="stroke-[2.5]" />
        </button>

        {/* Left: Full Access / Connector Status Pill */}
        <button
          type="button"
          onClick={onOpenConnectorDrawer}
          title="ExecOS Local Lane Connector Status"
          className="hidden sm:flex items-center gap-1 min-h-[36px] px-3 py-1 rounded-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-medium shrink-0 transition-colors cursor-pointer active:scale-95"
        >
          <ShieldAlert size={13} className="text-amber-400 shrink-0" />
          <span className="text-[11px] font-medium tracking-tight">Full access</span>
        </button>

        {/* Center: Textarea Input */}
        <div className="flex-1 min-w-0 flex items-center py-1">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isProcessing}
            className="w-full bg-transparent border-none outline-none resize-none text-[14px] text-zinc-100 placeholder:text-zinc-400 max-h-32 overflow-y-auto no-scrollbar font-sans leading-relaxed"
          />
        </div>

        {/* Right: Model Selector Pill */}
        <button
          type="button"
          onClick={() => setShowModelPicker(!showModelPicker)}
          className="hidden md:flex items-center gap-1.5 min-h-[36px] px-3 py-1 rounded-full bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 hover:text-white text-xs font-mono transition-colors shrink-0 cursor-pointer active:scale-95"
        >
          <span className="truncate max-w-[110px] text-[11px]">
            {currentModel === 'gemini-3.5-flash' ? 'gemini-3.5-flash' : currentModel}
          </span>
          <ChevronDown size={12} className="text-zinc-400" />
        </button>

        {/* Right: Voice Dictation Mic Button */}
        <button
          type="button"
          onClick={handleVoiceToggle}
          aria-label="Voice dictation"
          title={isRecording ? "Listening..." : "Dictate prompt"}
          className={cn(
            "min-w-[40px] min-h-[40px] w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all shrink-0 cursor-pointer active:scale-95 touch-manipulation",
            isRecording && "bg-rose-500 text-white animate-pulse"
          )}
        >
          {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        {/* Right: Circular Purple Submit Button */}
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={!inputText.trim() || isProcessing}
          aria-label="Send prompt"
          className={cn(
            "min-w-[40px] min-h-[40px] w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-150 shadow-md touch-manipulation",
            inputText.trim() && !isProcessing
              ? "bg-[#805ad5] hover:bg-[#6b46c1] text-white active:scale-95 shadow-purple-600/30 cursor-pointer"
              : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
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
  );
};
