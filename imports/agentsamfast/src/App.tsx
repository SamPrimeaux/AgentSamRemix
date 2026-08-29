import { LandingView } from './LandingView';
import React, { useState, useRef, useEffect } from 'react';
import { PulsatingDotsBackground } from './components/PulsatingDots';
import { 
  Search, Loader2, Sparkles, MessageSquareCode, FileText, Paperclip, 
  X, ArrowRight, UploadCloud, ChevronRight, BarChart3, Bot, ShieldAlert,
  Activity
} from 'lucide-react';
import ReportTemplate from "./ReportTemplate";
import { AgentTimeline, TimelineEvent } from './components/AgentTimeline';
import { FinancialChat, ChatAttachment } from './components/FinancialChat';
import { DurableJobsMonitor } from './components/DurableJobsMonitor';

export interface DocumentFinding {
  documentType?: string;
  document_type?: string;
  keyInsights?: string[];
  key_insights?: string[];
  date?: string;
  sourceUrl?: string;
  source_url?: string;
}

export interface DeepInsight {
  category: string;
  title: string;
  description: string;
  impact_score: number;
}

export interface ReportData {
  verdict?: {
    summary: string;
    conviction_score: number;
    key_takeaways: string[];
  };
  deep_insights?: DeepInsight[];
  findings?: DocumentFinding[];
  financial_charts?: {
    stock_price_4m: { date: string; price: number }[];
    financial_performance_4q: { quarter: string; revenue?: number; net_income?: number; distributions?: number }[];
  };
}

// Toggle this to true if you want the JSON logs to be downloaded automatically after a run.
const ENABLE_JSON_DOWNLOAD = false;

export default function App() {
  const [activeTab, setActiveTab] = useState<'dossier' | 'chat' | 'jobs'>('dossier');
  const [ticker, setTicker] = useState('');
  const [instruction, setInstruction] = useState('');
  
  // File attachments state for composer
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Gemini 3.5 Flash state
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const eventIdRef = useRef(0);
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [toolRuns, setToolRuns] = useState<number>(0);
  const [durationSecs, setDurationSecs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  // Perseus state
  const [runningPerseus, setRunningPerseus] = useState(false);
  const [errorPerseus, setErrorPerseus] = useState<string | null>(null);
  const [reportDataPerseus, setReportDataPerseus] = useState<ReportData | null>(null);
  const [eventsPerseus, setEventsPerseus] = useState<TimelineEvent[]>([]);
  const abortRefPerseus = useRef<AbortController | null>(null);
  const eventIdRefPerseus = useRef(0);
  const [tokenCountPerseus, setTokenCountPerseus] = useState<number>(0);
  const [toolRunsPerseus, setToolRunsPerseus] = useState<number>(0);
  const [durationSecsPerseus, setDurationSecsPerseus] = useState<number>(0);
  const [startTimePerseus, setStartTimePerseus] = useState<number | null>(null);

  const [isReportOpen, setIsReportOpen] = useState<'flash'|'perseus'|false>(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (running && startTime) {
      interval = setInterval(() => {
        setDurationSecs(Math.round((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [running, startTime]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (runningPerseus && startTimePerseus) {
      interval = setInterval(() => {
        setDurationSecsPerseus(Math.round((Date.now() - startTimePerseus) / 1000));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [runningPerseus, startTimePerseus]);

  const stopAgent = () => {
    if (abortRef.current) abortRef.current.abort();
    if (abortRefPerseus.current) abortRefPerseus.current.abort();
    setRunning(false);
    setRunningPerseus(false);
  };

  const createPushEvent = (setEvts: any, idRef: any) => (kind: TimelineEvent['kind'], label: string, detail?: string, toolName?: string, callId?: string) => {
    const now = Date.now();
    setEvts((prev: any) => {
      const newEvents = [...prev];
      if (newEvents.length > 0) {
        const lastIndex = newEvents.length - 1;
        if (!newEvents[lastIndex].endTime) {
          newEvents[lastIndex] = { ...newEvents[lastIndex], endTime: now };
        }
      }
      newEvents.push({ id: idRef.current++, kind, label, detail, toolName, startTime: now, callId });
      return newEvents;
    });
  };
  
  const pushEvent = createPushEvent(setEvents, eventIdRef);
  const pushEventPerseus = createPushEvent(setEventsPerseus, eventIdRefPerseus);

  const parseFinalText = (text: string) => {
    if (!text) return null;
    try {
      let foundData = null;
      const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
      for (let i = matches.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(matches[i][1]);
          if (parsed && (parsed.verdict || parsed.findings || parsed.deep_insights)) {
            foundData = parsed;
            break;
          }
        } catch (e) {}
      }
      
      if (!foundData) {
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            const possibleJson = text.slice(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(possibleJson);
            if (parsed && (parsed.verdict || parsed.findings || parsed.deep_insights)) {
              foundData = parsed;
            }
          } catch (e) {
            const match = text.match(/\{\s*"verdict"[\s\S]*?\}\s*\}/);
            if (match) {
              try {
                const parsed = JSON.parse(match[0]);
                if (parsed && parsed.verdict) {
                  foundData = parsed;
                }
              } catch(e2) {}
            }
          }
        }
      }
      return foundData;
    } catch (e) {
      return null;
    }
  };

  const handleFilesUpload = async (fileList: FileList | File[]) => {
    const newFiles: ChatAttachment[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > 20 * 1024 * 1024) {
        alert(`File ${file.name} exceeds 20MB limit.`);
        continue;
      }
      if (file.type.startsWith('text/') || file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.name.endsWith('.json') || file.name.endsWith('.md')) {
        const text = await file.text();
        newFiles.push({
          name: file.name,
          type: file.type || 'text/plain',
          size: file.size,
          text: text.slice(0, 100000)
        });
      } else {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => {
            const res = reader.result as string;
            const base64Data = res.split(',')[1] || '';
            resolve(base64Data);
          };
          reader.readAsDataURL(file);
        });
        const base64 = await base64Promise;
        newFiles.push({
          name: file.name,
          type: file.type || 'application/pdf',
          size: file.size,
          base64
        });
      }
    }
    setAttachedFiles(prev => [...prev, ...newFiles]);
  };

  const analyzeDroppedFiles = async () => {
    if (attachedFiles.length === 0) return;
    setIsReportOpen(false);
    setRunningPerseus(true);
    setErrorPerseus(null);
    setReportDataPerseus(null);
    setEventsPerseus([]);
    setTokenCountPerseus(0);
    setToolRunsPerseus(0);
    setDurationSecsPerseus(0);
    setStartTimePerseus(Date.now());
    eventIdRefPerseus.current = 0;

    pushEventPerseus('info', `Ingesting ${attachedFiles.length} attached document(s)...`);
    pushEventPerseus('thinking', `Extracting financial statements, ratios, and risk disclosures via Gemini Multimodal engine...`);

    try {
      const resp = await fetch('/api/analyze_files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: attachedFiles,
          title: attachedFiles.map(f => f.name).join(', '),
          instruction: instruction.trim() || undefined,
          model: 'gemini-3.7-flash'
        })
      });

      if (!resp.ok) {
        throw new Error(`Analysis server returned ${resp.status}`);
      }

      const reportJson = await resp.json();
      pushEventPerseus('tool_result', `Synthesis completed successfully`, JSON.stringify(reportJson.verdict, null, 2));
      setReportDataPerseus(reportJson);
      setTokenCountPerseus(Math.round(attachedFiles.reduce((acc, f) => acc + f.size, 0) / 4) + 1200);
      setDurationSecsPerseus(Math.round((Date.now() - (startTimePerseus || Date.now())) / 1000));
      setRunningPerseus(false);
      setIsReportOpen('perseus');
    } catch (e: any) {
      setErrorPerseus(e.message || 'File analysis failed');
      pushEventPerseus('error', `Analysis failed: ${e.message || 'Error'}`);
      setRunningPerseus(false);
    }
  };

  const startStream = async (
    model: string,
    setRun: any,
    setErr: any,
    setRep: any,
    setEvts: any,
    pushEvt: any,
    setTok: any,
    setTRuns: any,
    setDur: any,
    setStart: any,
    aRef: any,
    eIdRef: any
  ) => {
    setRun(true);
    setErr(null);
    setRep(null);
    setEvts([]);
    setTok(0);
    setTRuns(0);
    setDur(0);
    setStart(Date.now());
    eIdRef.current = 0;

    const controller = new AbortController();
    aRef.current = controller;
    const startTimestamp = Date.now();
    let currentToolRuns = 0;

    try {
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker.trim(),
          instruction: instruction.trim() || undefined,
          origin: window.location.origin,
          model: model
        }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`Server responded ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';

      while (true) {
        if (controller.signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
              const evt = JSON.parse(dataStr);
              if (evt.type === 'text' && evt.text) {
                  accumulatedText += evt.text;
              } else if (evt.type === 'tool_call') {
                  currentToolRuns += 1;
                  setTRuns(currentToolRuns);
                  let label = "Searching for SEC documents...";
                  if (evt.name === "google_search") {
                    label = `Searching SEC EDGAR: ${evt.arguments?.query || ''}`;
                  } else if (evt.name) {
                    label = `Agent Tool: ${evt.name}`;
                  }
                  pushEvt('tool_call', label, JSON.stringify(evt.arguments, null, 2), evt.name, evt.callId);
              } else if (evt.type === 'tool_result') {
                  pushEvt('tool_result', `Filing disclosure retrieved`, evt.result, undefined, evt.callId);
              } else if (evt.type === 'thinking') {
                  pushEvt('thinking', `Reasoning...`, evt.text);
              } else if (evt.type === 'complete') {
                  if (evt.interaction) {
                      const interaction = evt.interaction;
                      const usage = interaction.usage || interaction.usage_metadata || (interaction.metadata && interaction.metadata.usage) || null;
                      if (usage) {
                          const tokens = usage.total_token_count || usage.totalTokenCount || usage.total_tokens || 0;
                          if (tokens > 0) {
                              setTok(tokens);
                          }
                      }
                  }
              } else if (evt.type === 'final_stats') {
                  if (evt.tokens > 0) setTok(evt.tokens);
                  if (evt.duration > 0) setDur(Math.round(evt.duration));
                  if (ENABLE_JSON_DOWNLOAD && evt.jsonlLogUrl) {
                      fetch(evt.jsonlLogUrl)
                        .then(res => res.blob())
                        .then(blob => {
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = evt.jsonlLogUrl.split('/').pop() || 'run_log.jsonl';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            window.URL.revokeObjectURL(url);
                        })
                        .catch(err => console.error('Failed to download log:', err));
                  }
              }
            } catch { /* skip malformed */ }
          }
        }
        
        if (accumulatedText) {
            const foundData = parseFinalText(accumulatedText);
            if (foundData) setRep(foundData);
        }
      }
      
      if (buffer) {
          try {
              const lines = buffer.split('\n\n');
              for (const line of lines) {
                  if (line.startsWith('data: ')) {
                      const dataStr = line.slice(6);
                      if (dataStr === '[DONE]') continue;
                      const evt = JSON.parse(dataStr);
                      if (evt.type === 'text' && evt.text) {
                          accumulatedText += evt.text;
                      }
                  }
              }
          } catch(e) {}
      }
      
      if (accumulatedText) {
          const finalData = parseFinalText(accumulatedText);
          if (finalData) setRep(finalData);
      }
      
      setDur(Math.round((Date.now() - startTimestamp) / 1000));
      setRun(false);
      
    } catch (e: any) {
      if (e.name === 'AbortError') {
         console.log('Aborted');
      } else {
         setErr(e.message || 'Unknown error');
      }
      setDur(Math.round((Date.now() - startTimestamp) / 1000));
      setRun(false);
    }
  };

  const runAnalysis = () => {
    if (attachedFiles.length > 0 && !ticker.trim()) {
      analyzeDroppedFiles();
      return;
    }
    if (!ticker.trim() || running || runningPerseus) return;
    setIsReportOpen(false);
    
    startStream('gemini-3.5-flash', setRunning, setError, setReportData, setEvents, pushEvent, setTokenCount, setToolRuns, setDurationSecs, setStartTime, abortRef, eventIdRef);
    startStream('perseus', setRunningPerseus, setErrorPerseus, setReportDataPerseus, setEventsPerseus, pushEventPerseus, setTokenCountPerseus, setToolRunsPerseus, setDurationSecsPerseus, setStartTimePerseus, abortRefPerseus, eventIdRefPerseus);
  };

  if (isReportOpen === 'flash' && reportData) {
    return (
      <div className="w-full h-screen">
         <ReportTemplate 
           data={reportData} 
           ticker={ticker || 'Custom File'} 
           onClose={() => setIsReportOpen(false)}
           onOpenChat={() => { setIsReportOpen(false); setActiveTab('chat'); }}
           durationSecs={durationSecs}
           toolRuns={toolRuns}
           tokenCount={tokenCount}
           documentCount={reportData.findings?.length || 0}
         />
      </div>
    );
  }
  
  if (isReportOpen === 'perseus' && reportDataPerseus) {
    return (
      <div className="w-full h-screen">
         <ReportTemplate 
           data={reportDataPerseus} 
           ticker={ticker || (attachedFiles[0]?.name ? attachedFiles[0].name.slice(0, 16) : 'Custom File')} 
           onClose={() => setIsReportOpen(false)}
           onOpenChat={() => { setIsReportOpen(false); setActiveTab('chat'); }}
           durationSecs={durationSecsPerseus}
           toolRuns={toolRunsPerseus}
           tokenCount={tokenCountPerseus}
           documentCount={reportDataPerseus.findings?.length || 0}
         />
      </div>
    );
  }

  return (
    <div 
      className="relative h-screen bg-stone-950 overflow-hidden font-sans text-stone-100 flex flex-col"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleFilesUpload(e.dataTransfer.files);
        }
      }}
    >
      <PulsatingDotsBackground />

      {/* Global Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-stone-950/90 border-4 border-dashed border-emerald-400 z-50 flex flex-col items-center justify-center backdrop-blur-md pointer-events-none">
          <UploadCloud className="w-16 h-16 text-emerald-400 animate-bounce mb-4" />
          <h2 className="text-2xl font-bold text-white">Drop Financial Files to Ingest</h2>
          <p className="text-sm text-stone-300 mt-2">Supports PDFs, SEC 10-K/10-Q documents, CSVs, spreadsheets, transcripts</p>
        </div>
      )}
      
      {/* App Header */}
      <header className="relative z-30 flex items-center justify-between px-6 py-3.5 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="font-display font-bold text-lg tracking-wider uppercase text-white flex items-center gap-2">
              AgentSamFast
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono font-normal border border-emerald-500/30">
                PRO v2.0
              </span>
            </span>
            <span className="text-[11px] text-stone-400 font-mono hidden sm:inline">
              Autonomous Multimodal SEC & Financial Intelligence
            </span>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center bg-stone-900/90 p-1 rounded-lg border border-stone-800">
          <button
            id="tab-btn-dossier"
            onClick={() => setActiveTab('dossier')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === 'dossier'
                ? 'bg-stone-800 text-white shadow-sm border border-stone-700'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Filing Dossier</span>
          </button>
          
          <button
            id="tab-btn-chat"
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === 'chat'
                ? 'bg-stone-800 text-white shadow-sm border border-stone-700'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <MessageSquareCode className="w-3.5 h-3.5 text-purple-400" />
            <span>Financial Chatbot</span>
          </button>

          <button
            id="tab-btn-jobs"
            onClick={() => setActiveTab('jobs')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === 'jobs'
                ? 'bg-stone-800 text-white shadow-sm border border-stone-700'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            <span>Durable Jobs</span>
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <main className="relative z-10 flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === 'jobs' ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <DurableJobsMonitor />
          </div>
        ) : activeTab === 'chat' ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <FinancialChat 
              initialTicker={ticker} 
              attachedFiles={attachedFiles}
              onRemoveAttachedFile={(idx) => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
              onClearAttachedFiles={() => setAttachedFiles([])}
            />
          </div>
        ) : (
          <>
            {!running && !runningPerseus && !reportData && !reportDataPerseus && events.length === 0 && eventsPerseus.length === 0 ? (
               <LandingView 
                 onSelectSample={(sym) => {
                   setTicker(sym);
                   // run sample
                 }}
                 onOpenChat={() => setActiveTab('chat')}
               />
            ) : (
               <div className="flex-1 flex flex-row overflow-hidden pb-36 gap-4 px-4 min-h-0 w-full max-w-4xl mx-auto pt-4">
                  <div className="flex-1 flex flex-col bg-stone-900/50 rounded-xl border border-stone-800 overflow-hidden min-h-0">
                    <div className="p-3 bg-stone-800/80 border-b border-stone-700 font-bold text-stone-200 text-sm flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg" alt="Gemini Sparkle" className="w-5 h-5" />
                        <span>Autonomous SEC Reasoning Agent</span>
                      </div>
                      {runningPerseus && <Loader2 className="w-4 h-4 animate-spin text-stone-400" />}
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                      <AgentTimeline 
                        events={eventsPerseus} 
                        running={runningPerseus} 
                        hasReport={!!reportDataPerseus && isReportOpen !== 'perseus'}
                        onViewReport={() => setIsReportOpen('perseus')}
                        metrics={reportDataPerseus ? { durationSecs: durationSecsPerseus, tokenCount: tokenCountPerseus, documentCount: reportDataPerseus.findings?.length || 0 } : undefined}
                      />
                    </div>
                  </div>
               </div>
            )}

            {/* Input & File Composer Bar Fixed at Bottom */}
            <div className="mt-auto px-4 sm:px-6 pb-6 pt-4 bg-gradient-to-t from-stone-950 via-stone-950/95 to-transparent w-full fixed bottom-0 z-20">
              <div className="max-w-4xl mx-auto w-full">
                {error && (
                  <div className="mb-3 bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-2.5 rounded-lg text-xs">
                    {error}
                  </div>
                )}

                {/* Attached File Pills in Composer */}
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mb-2 p-2 bg-stone-900/80 rounded-lg border border-stone-700/80">
                    <span className="text-[11px] font-mono uppercase text-stone-400 flex items-center gap-1 mr-1">
                      <FileText className="w-3.5 h-3.5 text-emerald-400" />
                      Attached:
                    </span>
                    {attachedFiles.map((file, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-stone-800 border border-stone-600 text-xs text-stone-200 font-mono"
                      >
                        <span className="truncate max-w-[160px]">{file.name}</span>
                        <span className="text-[10px] text-stone-400">({(file.size / 1024).toFixed(0)}KB)</span>
                        <button
                          onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                          className="text-stone-400 hover:text-red-400 transition-colors ml-0.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setAttachedFiles([])}
                      className="text-[11px] text-stone-400 hover:text-stone-200 underline ml-auto mr-1"
                    >
                      Clear all
                    </button>
                  </div>
                )}

                {/* Main Composer Box */}
                <div className="bg-stone-900/90 backdrop-blur-md border border-stone-700/80 rounded-xl shadow-2xl p-2 w-full flex items-center gap-2 relative z-30 transition-all focus-within:border-emerald-500/80 focus-within:ring-1 focus-within:ring-emerald-500/80">
                  
                  {/* File Upload / Attach Button */}
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={(e) => e.target.files && handleFilesUpload(e.target.files)} 
                    multiple 
                    accept=".pdf,.csv,.tsv,.txt,.json,.md,.xlsx,.docx"
                    className="hidden" 
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2.5 text-stone-400 hover:text-emerald-400 hover:bg-stone-800 rounded-lg transition-colors shrink-0"
                    title="Drop or attach financial files (PDFs, CSVs, 10-K reports, spreadsheets)"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  <div className="py-2 flex items-center gap-2 text-stone-400 w-full flex-1">
                     <Search className="w-4 h-4 shrink-0 text-stone-500" />
                     <input 
                       type="text" 
                       value={ticker}
                       onChange={(e) => setTicker(e.target.value)}
                       placeholder={attachedFiles.length > 0 ? "Add optional prompt or hit Analyze on attached files..." : "Enter a stock/ETF ticker (e.g. NVDA, AAPL) or drop financial files..."} 
                       disabled={running || runningPerseus}
                       className="bg-transparent border-none outline-none w-full text-white font-mono uppercase placeholder-stone-500 text-sm placeholder:normal-case"
                       onKeyDown={(e) => e.key === 'Enter' && runAnalysis()}
                     />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {attachedFiles.length > 0 && (
                      <button
                        onClick={() => setActiveTab('chat')}
                        className="bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-600 px-3 py-2 rounded-lg font-medium transition-colors text-xs flex items-center gap-1.5"
                      >
                        <MessageSquareCode className="w-3.5 h-3.5 text-purple-400" />
                        <span className="hidden sm:inline">Chat with Files</span>
                      </button>
                    )}
                    <button 
                      onClick={runAnalysis}
                      disabled={(!ticker.trim() && attachedFiles.length === 0) || running || runningPerseus}
                      className="bg-white text-black hover:bg-stone-200 disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed px-5 py-2 rounded-lg font-medium transition-colors tracking-wide text-xs flex items-center gap-1.5 active:scale-95 shadow-sm"
                    >
                      {running || runningPerseus ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Synthesizing...</span>
                        </>
                      ) : (
                        <>
                          <span>Analyze</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
                
                <div className="text-center mt-2.5 flex items-center justify-between px-2 text-[11px] text-stone-400 font-mono">
                  <span>AgentSamFast • Autonomous Multimodal Research</span>
                  <span className="hidden sm:inline">Drop PDFs, CSVs, 10-K filings anywhere to analyze</span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

