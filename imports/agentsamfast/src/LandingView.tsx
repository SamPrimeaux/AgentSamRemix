import React from 'react';
import { Activity, ShieldAlert, FileText, CheckCircle2, UploadCloud, MessageSquareCode, Sparkles, Cpu } from 'lucide-react';

interface LandingViewProps {
  onSelectSample?: (ticker: string) => void;
  onOpenChat?: () => void;
}

export function LandingView({ onSelectSample, onOpenChat }: LandingViewProps) {
  const sampleTickers = ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN", "SPY"];

  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 md:p-8 overflow-y-auto no-scrollbar">
      <div className="relative z-10 w-full max-w-4xl mx-auto flex flex-col items-center py-6 md:py-10">
        
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-stone-300 mb-6 backdrop-blur-md">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>AgentSamFast v2.0 • Autonomous Multimodal Research</span>
        </div>

        {/* Header */}
        <div className="text-center mb-8 max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4 font-serif">
            AgentSamFast, your intelligent <span className="italic font-serif text-emerald-400">financial document</span> analyzer
          </h1>
          <p className="text-base md:text-lg text-stone-300 font-normal max-w-2xl mx-auto leading-relaxed">
            Autonomous financial intelligence engine powered by Gemini & Thompson ML router. Synthesizes SEC EDGAR filings, analyzes multi-quarter earnings, or processes dropped financial documents.
          </p>
        </div>

        {/* Quick Sample Ticker Pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          <span className="text-xs font-mono uppercase tracking-wider text-stone-400 mr-2">Try quick sample:</span>
          {sampleTickers.map((sym) => (
            <button
              key={sym}
              onClick={() => onSelectSample?.(sym)}
              className="px-3 py-1 rounded bg-stone-800/80 hover:bg-stone-700 border border-stone-700 hover:border-stone-500 text-stone-200 font-mono text-xs transition-all active:scale-95"
            >
              ${sym}
            </button>
          ))}
        </div>

        {/* 3 Pillar Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 w-full">
          
          {/* Card 1: Documents */}
          <div className="bg-stone-900/60 backdrop-blur-md border border-white/10 rounded-xl p-5 shadow-2xl flex flex-col hover:border-white/20 transition-colors">
            <div className="flex items-center gap-2 mb-4 text-emerald-400">
              <FileText className="w-5 h-5" />
              <h3 className="text-base font-semibold text-white">
                SEC Filing Engine
              </h3>
            </div>
            
            <div className="flex-1 flex flex-col gap-2.5 text-xs text-stone-300">
              <div className="flex items-center gap-2.5 p-2 rounded bg-white/5">
                <FileText className="w-3.5 h-3.5 text-stone-400" />
                <div>
                  <div className="font-medium text-white">Form 10-K & 10-Q</div>
                  <div className="text-[11px] text-stone-400">Audited Financials & MD&A</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded bg-white/5">
                <Activity className="w-3.5 h-3.5 text-stone-400" />
                <div>
                  <div className="font-medium text-white">Form 8-K & Press Releases</div>
                  <div className="text-[11px] text-stone-400">Material Events & Guidance</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded bg-white/5">
                <ShieldAlert className="w-3.5 h-3.5 text-stone-400" />
                <div>
                  <div className="font-medium text-white">Form 4 & 13F Holdings</div>
                  <div className="text-[11px] text-stone-400">Insider Buys & Whales</div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Drop Custom Files */}
          <div className="bg-stone-900/60 backdrop-blur-md border border-white/10 rounded-xl p-5 shadow-2xl flex flex-col hover:border-white/20 transition-colors">
            <div className="flex items-center gap-2 mb-4 text-blue-400">
              <UploadCloud className="w-5 h-5" />
              <h3 className="text-base font-semibold text-white">
                Drop Custom Files
              </h3>
            </div>
            
            <div className="flex-1 flex flex-col gap-2.5 text-xs text-stone-300">
              <div className="flex items-center gap-2.5 p-2 rounded bg-white/5">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-stone-300">Drop PDFs, CSVs, TSVs or notes directly into the composer</span>
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded bg-white/5">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-stone-300">Extracts multi-quarter tables, margins, and ratios instantly</span>
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded bg-white/5">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-stone-300">Synthesize earnings transcripts & custom memos into executive dossiers</span>
              </div>
            </div>
          </div>

          {/* Card 3: Multi-turn Chat */}
          <div className="bg-stone-900/60 backdrop-blur-md border border-white/10 rounded-xl p-5 shadow-2xl flex flex-col hover:border-white/20 transition-colors">
            <div className="flex items-center gap-2 mb-4 text-purple-400">
              <MessageSquareCode className="w-5 h-5" />
              <h3 className="text-base font-semibold text-white">
                Multi-Turn Chatbot
              </h3>
            </div>
            
            <div className="flex-1 flex flex-col gap-2.5 text-xs text-stone-300">
              <div className="flex items-center gap-2.5 p-2 rounded bg-white/5">
                <Cpu className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="text-stone-300">Gemini 3.7 Flash & 3.1 Pro models</span>
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded bg-white/5">
                <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="text-stone-300">Specialized personas: Equity Analyst, Forensic Auditor, Quant Strategist</span>
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded bg-white/5">
                <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="text-stone-300">Ask deep follow-up questions on reports and uploaded documents</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
