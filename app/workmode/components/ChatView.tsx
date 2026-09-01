import React, { useState, useRef, useEffect } from 'react';
import { 
  ThumbsUp, 
  Smile, 
  ClipboardList, 
  Sparkles, 
  CheckCircle2, 
  Copy, 
  Check, 
  ExternalLink,
  FileText,
  Layout,
  Terminal,
  Image as ImageIcon,
  Video,
  BarChart3,
  Zap,
  ArrowRight,
  Bot
} from 'lucide-react';
import { ChatMessageItem, ModelChoice, LiveBrowserSession } from '../types';
import { TaskTraceCard } from './TaskTraceCard';
import { WebSearchCard } from './browser/WebSearchCard';
import { LiveBrowserCard } from './browser/LiveBrowserCard';
import { LiveBrowserSheet } from './browser/LiveBrowserSheet';
import { UnifiedAgentComposer } from './common/UnifiedAgentComposer';
import { useWorkModeConfig } from '../context/WorkModeConfigContext';
import { cn } from '../../lib/utils';

interface ChatViewProps {
  messages: ChatMessageItem[];
  onSendMessage: (text: string, model: ModelChoice) => void;
  isProcessing: boolean;
  selectedModel: ModelChoice;
  onSelectModel: (model: ModelChoice) => void;
  onOpenTerminal: () => void;
  onNavigateToWork: () => void;
  activeBranch: string;
  activePath: string;
  onBranchChange: (b: string) => void;
  onPathChange: (p: string) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  onSendMessage,
  isProcessing,
  selectedModel,
  onSelectModel,
  onOpenTerminal,
  onNavigateToWork,
  activeBranch,
  activePath,
  onBranchChange,
  onPathChange,
}) => {
  const { config } = useWorkModeConfig();
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [activeLiveSession, setActiveLiveSession] = useState<LiveBrowserSession | null>(null);
  const [activeReactions, setActiveReactions] = useState<Record<string, string[]>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 1500);
  };

  const toggleReaction = (msgId: string, reactionKey: string) => {
    setActiveReactions(prev => {
      const current = prev[msgId] || [];
      if (current.includes(reactionKey)) {
        return { ...prev, [msgId]: current.filter(r => r !== reactionKey) };
      } else {
        return { ...prev, [msgId]: [...current, reactionKey] };
      }
    });
  };

  const renderReactionIcon = (reactionKey: string) => {
    switch (reactionKey) {
      case 'thumbs-up':
      case '👍':
        return <ThumbsUp size={12} className="text-blue-500" />;
      case 'smile':
      case '😊':
        return <Smile size={12} className="text-amber-500" />;
      case 'clipboard':
      case '📋':
        return <ClipboardList size={12} className="text-purple-500" />;
      case 'sparkles':
      case '✨':
        return <Sparkles size={12} className="text-amber-400" />;
      default:
        return <CheckCircle2 size={12} className="text-emerald-500" />;
    }
  };

  const starterCapabilities = [
    {
      id: 'cap-deck',
      icon: FileText,
      iconBg: 'bg-blue-500/10 text-blue-500 dark:bg-blue-500/20',
      title: 'Synthesize Pitch Deck',
      desc: '4-slide enterprise narrative with financial metrics & ROI models',
      prompt: `Synthesize a 4-slide executive presentation deck for ${config.clientBrandName} with Q4 financial roadmap.`
    },
    {
      id: 'cap-cms',
      icon: Layout,
      iconBg: 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20',
      title: 'Scaffold Website with CMS',
      desc: 'Responsive hero, bento layout, feature blocks & live preview',
      prompt: `Build a responsive client landing page for ${config.clientBrandName} with hero, bento grid, and pricing.`
    },
    {
      id: 'cap-test',
      icon: Terminal,
      iconBg: 'bg-purple-500/10 text-purple-500 dark:bg-purple-500/20',
      title: 'Run Auth Security Tests',
      desc: 'Execute 18 automated suite assertions on local lane',
      prompt: 'Run the auth test suite and verify all assertions on local lane.'
    },
    {
      id: 'cap-brand',
      icon: ImageIcon,
      iconBg: 'bg-amber-500/10 text-amber-500 dark:bg-amber-500/20',
      title: 'Generate 1K Brand Assets',
      desc: 'High-res octane rendered flagship showroom visuals',
      prompt: `Generate 1K brand assets using gemini-3.1-flash-image for ${config.clientBrandName} futuristic flagship showroom.`
    }
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-zinc-50/30 dark:bg-black/30">
      {/* Scrollable Message List */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-5 select-text">
        {messages.map((msg) => {
          const isAgent = msg.role === 'agent';
          const msgReactions = msg.reactions || ['thumbs-up', 'smile', 'clipboard'];
          const userSelectedReactions = activeReactions[msg.id] || [];

          return (
            <div key={msg.id} className="w-full flex items-start gap-3 transition-opacity">
              {/* Avatar Pill */}
              <div
                className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-bold text-xs shadow-xs",
                  isAgent
                    ? "bg-zinc-900 dark:bg-emerald-600 text-white ring-2 ring-emerald-500/20"
                    : "bg-blue-600 dark:bg-blue-500 text-white ring-2 ring-blue-500/20"
                )}
              >
                {msg.authorInitials}
              </div>

              {/* Message Body */}
              <div className="flex-1 min-w-0">
                {/* Header: Author + Timestamp */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-bold text-[14px] text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    {msg.authorName}
                    {isAgent && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono font-medium">
                        Autonomous
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">
                    {msg.timestamp}
                  </span>
                </div>

                {/* 1. Web Search Compact Row (if present) */}
                {msg.webSearchEvent && (
                  <WebSearchCard event={msg.webSearchEvent} />
                )}

                {/* 2. Live Browser Card (if remote Chromium session) */}
                {msg.liveBrowserSession && (
                  <LiveBrowserCard 
                    session={msg.liveBrowserSession} 
                    onOpenLiveSheet={() => setActiveLiveSession(msg.liveBrowserSession!)} 
                  />
                )}

                {/* Content Text */}
                <div className="text-[14.5px] leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-line">
                  {msg.content}
                </div>

                {/* Citations List (if present) */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs font-mono">
                    <span className="text-[11px] text-zinc-400 font-sans mr-1">Sources:</span>
                    {msg.citations.map((c) => (
                      <a
                        key={c.id}
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center gap-1 transition-colors border border-zinc-200/60 dark:border-zinc-700/60"
                      >
                        <span className="font-bold text-blue-500">[{c.sourceIndex}]</span>
                        <span className="truncate max-w-[140px]">{c.title}</span>
                        <ExternalLink size={10} className="text-zinc-400" />
                      </a>
                    ))}
                  </div>
                )}

                {/* Structured Task Trace Card (if present) */}
                {msg.taskTrace && (
                  <TaskTraceCard
                    trace={msg.taskTrace}
                    onOpenTerminal={onOpenTerminal}
                    onViewWorkMode={onNavigateToWork}
                  />
                )}

                {/* Lucide-based Reaction and Action Chips */}
                {isAgent && (
                  <div className="flex items-center gap-1.5 mt-2.5">
                    {msgReactions.map((reaction, idx) => {
                      const isSelected = userSelectedReactions.includes(reaction);
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => toggleReaction(msg.id, reaction)}
                          title={`React with ${reaction}`}
                          className={cn(
                            "w-7 h-7 rounded-lg border flex items-center justify-center transition-all shadow-2xs",
                            isSelected
                              ? "bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 scale-105"
                              : "bg-white dark:bg-zinc-850 border-zinc-200 dark:border-zinc-750 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          )}
                        >
                          {renderReactionIcon(reaction)}
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => handleCopyMessage(msg.id, msg.content)}
                      title="Copy response"
                      className="w-7 h-7 rounded-lg bg-white dark:bg-zinc-850 border border-zinc-200 dark:border-zinc-750 flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors shadow-2xs"
                    >
                      {copiedMsgId === msg.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Dynamic Capability Starters when conversation is clean & fresh */}
        {messages.length <= 1 && (
          <div className="pt-2 pb-3">
            <div className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 mb-2.5 flex items-center gap-1.5 uppercase tracking-wider">
              <Zap size={13} className="text-amber-500" />
              <span>Ready to test true capabilities</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {starterCapabilities.map((cap) => {
                const Icon = cap.icon;
                return (
                  <button
                    key={cap.id}
                    type="button"
                    onClick={() => onSendMessage(cap.prompt, selectedModel)}
                    disabled={isProcessing}
                    className="p-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 hover:border-blue-400/60 dark:hover:border-blue-500/50 hover:shadow-md transition-all text-left group flex items-start gap-3"
                  >
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105", cap.iconBg)}>
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors flex items-center justify-between">
                        <span>{cap.title}</span>
                        <ArrowRight size={12} className="text-zinc-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-2 leading-snug">
                        {cap.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Live streaming indicator when processing */}
        {isProcessing && (
          <div className="w-full flex items-start gap-3 animate-in fade-in duration-200">
            <div className="w-8 h-8 rounded-xl bg-zinc-900 dark:bg-emerald-600 text-white flex items-center justify-center font-bold text-xs ring-2 ring-emerald-500/20">
              AS
            </div>
            <div className="flex-1 bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
              <div className="flex items-center gap-2.5 text-xs text-zinc-700 dark:text-zinc-300 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                <span className="flex items-center gap-1">
                  <span>Agent Sam is executing task with</span>
                  <span className="font-mono font-bold text-blue-500">{selectedModel}</span>
                  <span>...</span>
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Live Browser Bottom Sheet (if active) */}
      <LiveBrowserSheet
        isOpen={!!activeLiveSession}
        onClose={() => setActiveLiveSession(null)}
        session={activeLiveSession || undefined}
      />

      {/* Unified Chat Composer across whole app */}
      <div className="p-3 sm:p-4 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md border-t border-zinc-200/80 dark:border-zinc-800/80 z-20">
        <UnifiedAgentComposer
          onSendMessage={onSendMessage}
          isProcessing={isProcessing}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          onOpenTerminal={onOpenTerminal}
          activeBranch={activeBranch}
          activePath={activePath}
          onBranchChange={onBranchChange}
          onPathChange={onPathChange}
          placeholder="Message Agent Sam or pick a task capability..."
        />
      </div>
    </div>
  );
};
