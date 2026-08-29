import React, { useState } from 'react';
import { 
  X, FileText, CheckCircle2, ChevronRight, Link as LinkIcon, Calendar,
  TrendingUp, TrendingDown, Minus, Lightbulb, AlertTriangle, MessageSquareCode, 
  Sparkles, Download, Check, ExternalLink, Printer
} from 'lucide-react';
import { ReportData } from './App';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { generateExecutiveHTMLReport } from './lib/htmlReportGenerator';

interface Props {
  data: ReportData;
  ticker: string;
  onClose: () => void;
  onOpenChat?: () => void;
  durationSecs?: number;
  toolRuns?: number;
  tokenCount?: number;
  documentCount?: number;
}

const AnalysisCard = ({ title, subtext, children, className = "" }: any) => (
  <div className={`bg-white rounded-xl p-4 sm:p-6 border border-stone-200 shadow-sm flex flex-col ${className}`}>
    <div className="flex justify-between items-start mb-1.5 sm:mb-2">
      <h3 className="text-base sm:text-lg font-bold text-stone-900">{title}</h3>
    </div>
    {subtext && (
      <div className="text-stone-600 text-xs sm:text-[14px] mb-4 sm:mb-6 leading-relaxed">
        {subtext}
      </div>
    )}
    <div className="flex-1 w-full flex flex-col">
      {children}
    </div>
  </div>
);

export default function ReportTemplate({ data, ticker, onClose, onOpenChat, durationSecs = 0, toolRuns = 0, tokenCount = 0, documentCount = 0 }: Props) {
  const [copiedHtml, setCopiedHtml] = useState(false);

  const scoreColor = (score: number) => {
    if (score >= 80) return 'text-[#0b5a4b]';
    if (score >= 60) return 'text-blue-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const findings = data.findings || [];

  const handleDownloadHtml = () => {
    const html = generateExecutiveHTMLReport(data, ticker, {
      durationSecs,
      toolRuns,
      tokenCount,
      documentCount: documentCount || findings.length,
    });

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AgentSamFast-${ticker.toUpperCase()}-Dossier.html`;
    a.click();
    URL.revokeObjectURL(url);

    setCopiedHtml(true);
    setTimeout(() => setCopiedHtml(false), 2500);
  };
  
  return (
    <div className="min-h-full bg-[#F6F4F0] text-stone-900 font-sans w-full flex flex-col h-full overflow-y-auto">
      {/* Sticky Header with responsive padding & actions */}
      <div className="w-full border-b border-stone-200 px-4 sm:px-8 py-3.5 flex items-center justify-between sticky top-0 z-50 bg-[#F6F4F0]/95 backdrop-blur-md">
        <div className="font-display uppercase font-bold text-stone-900 text-sm sm:text-base tracking-wider flex items-center gap-2 truncate">
          <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="truncate">AgentSamFast • {ticker} Dossier</span>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            onClick={handleDownloadHtml}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 text-xs font-semibold shadow-xs transition-all active:scale-95"
            title="Download standalone executive HTML dossier"
          >
            {copiedHtml ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Download className="w-3.5 h-3.5 text-stone-600" />}
            <span className="hidden sm:inline">{copiedHtml ? 'Exported!' : 'Export HTML'}</span>
          </button>

          {onOpenChat && (
            <button
              onClick={onOpenChat}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 text-xs font-semibold shadow-sm transition-all active:scale-95"
            >
              <MessageSquareCode className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Ask AI Chatbot</span>
              <span className="sm:hidden">Chat</span>
            </button>
          )}
          <button 
            onClick={onClose}
            className="text-stone-700 hover:text-stone-900 transition-colors flex items-center justify-center p-1.5 sm:p-2 rounded-lg hover:bg-stone-200/60"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 py-4 sm:py-8 px-4 sm:px-8 w-full max-w-[1200px] mx-auto flex flex-col gap-5 sm:gap-6">
        
        {/* Executive Summary */}
        <div className="flex flex-col gap-6">
          <AnalysisCard title="Executive Summary" className="w-full">
            <div className="bg-stone-50 p-4 sm:p-5 rounded-xl border border-stone-100 mb-5 sm:mb-6 text-stone-800 leading-relaxed font-medium text-base sm:text-lg w-full">
              "{data.verdict?.summary || 'No summary available.'}"
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-10 gap-6 md:gap-8 w-full mt-2">
              <div className="md:col-span-7 flex flex-col">
                {data.verdict?.key_takeaways && (Array.isArray(data.verdict.key_takeaways) ? data.verdict.key_takeaways.length > 0 : true) && (
                  <div className="w-full text-left flex-1">
                     <div className="text-xs sm:text-sm font-bold text-stone-500 uppercase tracking-wider mb-3 sm:mb-4 border-b border-stone-100 pb-2">Key Takeaways</div>
                     <div className="space-y-3">
                       {Array.isArray(data.verdict.key_takeaways) ? data.verdict.key_takeaways.map((takeaway, i) => (
                          <div key={i} className="flex gap-2.5 sm:gap-3 text-sm sm:text-base">
                             <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-[#0b5a4b] shrink-0 mt-0.5" />
                             <div className="text-stone-700 leading-relaxed">{takeaway}</div>
                          </div>
                       )) : (
                          <div className="flex gap-2.5 sm:gap-3 text-sm sm:text-base">
                             <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-[#0b5a4b] shrink-0 mt-0.5" />
                             <div className="text-stone-700 leading-relaxed">{String(data.verdict.key_takeaways)}</div>
                          </div>
                       )}
                     </div>
                  </div>
                )}
              </div>
              
              <div className="md:col-span-3 flex flex-col h-full text-center md:border-l md:border-stone-100 md:pl-8 pt-4 md:pt-0 border-t md:border-t-0 border-stone-100">
                 <h4 className="text-xs sm:text-sm font-bold text-stone-500 uppercase tracking-wider mb-1">Conviction Score</h4>
                 <p className="text-[11px] text-stone-400 mb-3 sm:mb-4">Based on verified filing disclosures</p>
                 <div className={`text-5xl sm:text-6xl font-display font-bold mb-1 flex-1 flex items-center justify-center ${data.verdict ? scoreColor(data.verdict.conviction_score) : 'text-stone-400'}`}>
                    {data.verdict?.conviction_score || '-'}
                 </div>
                 
                 <div className="text-[11px] text-stone-500 uppercase tracking-widest font-bold mb-4 sm:mb-6">out of 100</div>
                 <div className="grid grid-cols-4 gap-1 border-t border-stone-100 pt-3 sm:pt-4 mt-auto w-full">
                   <div className="flex flex-col items-center">
                     <div className="text-[9px] sm:text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-0.5">Docs</div>
                     <div className="text-xs sm:text-sm font-mono text-stone-800">{documentCount || findings.length}</div>
                   </div>
                   <div className="flex flex-col items-center border-l border-stone-100">
                     <div className="text-[9px] sm:text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-0.5">Time</div>
                     <div className="text-xs sm:text-sm font-mono text-stone-800">{durationSecs}s</div>
                   </div>
                   <div className="flex flex-col items-center border-l border-stone-100">
                     <div className="text-[9px] sm:text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-0.5">Runs</div>
                     <div className="text-xs sm:text-sm font-mono text-stone-800">{toolRuns}</div>
                   </div>
                   <div className="flex flex-col items-center border-l border-stone-100">
                     <div className="text-[9px] sm:text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-0.5">Tokens</div>
                     <div className="text-xs sm:text-sm font-mono text-stone-800">
                        {tokenCount > 0 ? (tokenCount / 1000).toFixed(1) + 'k' : '-'}
                     </div>
                   </div>
                 </div>
              </div>
            </div>
          </AnalysisCard>
        </div>

        {/* Financial Charts */}
        {data.financial_charts && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 mt-2 sm:mt-4">
            <AnalysisCard title="Stock Price" subtext="Historical closing price for the past four months on the last trading date.">
              <div className="h-56 sm:h-64 mt-2 sm:mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.financial_charts.stock_price_4m ? [...data.financial_charts.stock_price_4m] : []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e4" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#78716c' }} dy={10} />
                    <YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#78716c' }} dx={-10} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e4', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                      formatter={(value: number) => [`$${value}`, 'Price']}
                    />
                    <Line type="linear" dataKey="price" stroke="#0b5a4b" strokeWidth={2.5} dot={{ r: 4, fill: '#0b5a4b', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </AnalysisCard>
            
            <AnalysisCard 
              title="Financial Performance"
              subtext={data.financial_charts.financial_performance_4q && data.financial_charts.financial_performance_4q.length > 0 && data.financial_charts.financial_performance_4q[0].distributions !== undefined ? "Quarterly distributions (dividends/yield per share) for the past four completed quarters." : "Quarterly revenue and net income for the past four completed quarters."}
            >
              <div className="h-56 sm:h-64 mt-2 sm:mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.financial_charts.financial_performance_4q ? [...data.financial_charts.financial_performance_4q] : []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e4" />
                    <XAxis dataKey="quarter" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#78716c' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#78716c' }} dx={-10} tickFormatter={(value) => data.financial_charts?.financial_performance_4q?.[0]?.distributions !== undefined ? `$${value}` : `${value}B`} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e4', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                      formatter={(value: number, name: string) => name === 'Distributions' ? [`$${value}`, name] : [`$${value}B`, name]}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '16px' }} />
                    {data.financial_charts.financial_performance_4q && data.financial_charts.financial_performance_4q.length > 0 && data.financial_charts.financial_performance_4q[0].distributions !== undefined ? (
                      <Bar dataKey="distributions" name="Distributions" fill="#10b981" radius={[4, 4, 0, 0]} barSize={40} />
                    ) : (
                      <>
                        <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={26} />
                        <Bar dataKey="net_income" name="Net Income" fill="#1e3a8a" radius={[4, 4, 0, 0]} barSize={26} />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </AnalysisCard>
          </div>
        )}

        {/* Deep Insights */}
        {data.deep_insights && data.deep_insights.length > 0 && (
          <div className="mt-4 sm:mt-6">
            <h2 className="text-xl sm:text-2xl font-display font-bold text-stone-900 uppercase tracking-wider mb-4 sm:mb-6">Deep Insights</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
              {data.deep_insights.slice(0, 3).map((insight, index) => (
                <div key={index} className="bg-white p-5 sm:p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col">
                   <div className="flex items-start justify-between mb-3 sm:mb-4 border-b border-stone-100 pb-3 sm:pb-4">
                     <div className="flex items-center gap-3">
                       <div>
                         <div className="text-[11px] text-stone-500 font-bold uppercase tracking-wider">{insight.category}</div>
                         <h4 className="font-bold text-stone-900 text-base sm:text-lg mt-0.5 leading-tight">{insight.title}</h4>
                       </div>
                     </div>
                   </div>
                   <div className="text-stone-700 leading-relaxed text-xs sm:text-[14px] flex-1">{insight.description}</div>
                   <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-stone-100 flex items-center justify-between">
                     <span className="text-[11px] text-stone-500 font-bold uppercase tracking-wider">Impact Score</span>
                     <span className={`text-xs sm:text-sm font-mono font-bold px-2 py-0.5 rounded ${insight.impact_score >= 8 ? 'bg-red-50 text-red-700' : insight.impact_score >= 5 ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700'}`}>{insight.impact_score}/10</span>
                   </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detailed Findings */}
        <div className="mt-4 sm:mt-6 pb-8">
           <h2 className="text-xl sm:text-2xl font-display font-bold text-stone-900 uppercase tracking-wider mb-4 sm:mb-6">Document Findings</h2>
           
           {findings.length === 0 ? (
             <div className="text-stone-500 italic p-6 sm:p-8 bg-white rounded-xl border border-stone-200 text-center text-sm">
               No specific document findings returned.
             </div>
           ) : (
             <div className="flex flex-col gap-4 sm:gap-6">
               {findings.map((finding, index) => (
                 <div key={index} className="bg-white p-4 sm:p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col">
                   <div className="flex items-start justify-between mb-3 sm:mb-4 border-b border-stone-100 pb-3 sm:pb-4">
                     <div className="flex items-center gap-3">
                       <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-stone-100 text-stone-600 flex items-center justify-center shrink-0">
                         <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                       </div>
                       <div>
                         <h4 className="font-bold text-stone-900 text-base sm:text-lg">{finding.documentType || finding.document_type || "Document"}</h4>
                         {finding.date && (
                           <div className="text-xs text-stone-500 font-mono flex items-center gap-1 mt-0.5 sm:mt-1">
                             <Calendar className="w-3 h-3" /> {finding.date}
                           </div>
                         )}
                       </div>
                     </div>
                     {(finding.sourceUrl || finding.source_url) && (
                       <a href={finding.sourceUrl || finding.source_url} target="_blank" rel="noreferrer" className="hover:opacity-80 transition-opacity flex items-center justify-center p-1" title="View Source">
                         <img src="https://upload.wikimedia.org/wikipedia/commons/8/87/PDF_file_icon.svg" alt="PDF" className="w-7 h-7 sm:w-8 sm:h-8" />
                       </a>
                     )}
                   </div>
                   
                   <ul className="space-y-2.5 sm:space-y-3 mt-1 flex-1">
                     {Array.isArray(finding.keyInsights || finding.key_insights) ? (finding.keyInsights || finding.key_insights)?.map((insight, i) => (
                       <li key={i} className="flex gap-2 text-xs sm:text-sm text-stone-700 leading-relaxed">
                         <ChevronRight className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                         <span>{insight}</span>
                       </li>
                     )) : (finding.keyInsights || finding.key_insights) ? (
                       <li className="flex gap-2 text-xs sm:text-sm text-stone-700 leading-relaxed">
                         <ChevronRight className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                         <span>{String(finding.keyInsights || finding.key_insights)}</span>
                       </li>
                     ) : null}
                   </ul>
                 </div>
               ))}
             </div>
           )}
        </div>
      </div>
    </div>
  );
}
