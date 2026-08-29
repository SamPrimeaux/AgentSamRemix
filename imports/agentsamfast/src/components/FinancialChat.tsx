import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { 
  Send, Bot, User, Paperclip, X, Trash2, Download, RefreshCw, 
  Sparkles, ShieldAlert, TrendingUp, FileText, Cpu, Check, Copy,
  ArrowDown
} from 'lucide-react';

export interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  base64?: string;
  text?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  files?: ChatAttachment[];
  model?: string;
}

interface FinancialChatProps {
  initialTicker?: string;
  attachedFiles?: ChatAttachment[];
  onRemoveAttachedFile?: (index: number) => void;
  onClearAttachedFiles?: () => void;
}

const ROLES = [
  {
    id: 'equity_analyst',
    name: 'Senior Equity Analyst',
    icon: TrendingUp,
    description: 'Valuation multiples, moat durability, growth and cash flows'
  },
  {
    id: 'sec_auditor',
    name: 'SEC Forensic Auditor',
    icon: ShieldAlert,
    description: '10-K/10-Q disclosures, footnote accounting, risk items'
  },
  {
    id: 'quant_strategist',
    name: 'Macro Quant Strategist',
    icon: Cpu,
    description: 'Factor exposures, catalyst timing, volatility regime'
  },
  {
    id: 'general_assistant',
    name: 'AgentSamFast Copilot',
    icon: Bot,
    description: 'Autonomous financial intelligence & general analysis'
  }
];

const MODELS = [
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', tag: 'Recommended' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', tag: 'Fast' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', tag: 'Deep Reasoning' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', tag: 'Ultra-Lite' },
];

const STARTER_PROMPTS = [
  "Analyze revenue composition and gross margin trajectory for NVDA",
  "Audit the top risk factors from the latest Form 10-K disclosure",
  "Compare Free Cash Flow conversion vs Net Income quality",
  "Calculate EV/EBITDA and forward P/E given current guidance"
];

export function FinancialChat({ 
  initialTicker = '', 
  attachedFiles = [], 
  onRemoveAttachedFile, 
  onClearAttachedFiles 
}: FinancialChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    return [
      {
        id: 'welcome',
        role: 'model',
        content: `👋 **Welcome to AgentSamFast Financial Chatbot.**\n\nI am your autonomous research assistant powered by Google Gemini. You can ask deep financial questions, audit SEC filings, analyze stock tickers, or drop in custom financial documents (PDFs, earnings spreadsheets, CSVs, transcripts).\n\nSelect a specialized role or try one of the prompt suggestions below to get started.`,
        timestamp: Date.now(),
        model: 'gemini-3.7-flash'
      }
    ];
  });

  const [input, setInput] = useState('');
  const [selectedRole, setSelectedRole] = useState('equity_analyst');
  const [selectedModel, setSelectedModel] = useState('gemini-3.7-flash');
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [localFiles, setLocalFiles] = useState<ChatAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // Sync external attached files if any
  useEffect(() => {
    if (attachedFiles && attachedFiles.length > 0) {
      setLocalFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const newOnes = attachedFiles.filter(f => !existingNames.has(f.name));
        return [...prev, ...newOnes];
      });
    }
  }, [attachedFiles]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  const handleScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 150);
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const newAttachments: ChatAttachment[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > 20 * 1024 * 1024) {
        alert(`File ${file.name} exceeds 20MB limit.`);
        continue;
      }

      if (file.type.startsWith('text/') || file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.name.endsWith('.json') || file.name.endsWith('.md')) {
        const text = await file.text();
        newAttachments.push({
          name: file.name,
          type: file.type || 'text/plain',
          size: file.size,
          text: text.slice(0, 100000) // safety limit
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
        newAttachments.push({
          name: file.name,
          type: file.type || 'application/pdf',
          size: file.size,
          base64
        });
      }
    }

    setLocalFiles(prev => [...prev, ...newAttachments]);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const content = (textToSend || input).trim();
    if ((!content && localFiles.length === 0) || isStreaming) return;

    const userMessageId = 'usr_' + Date.now();
    const filesToSend = [...localFiles];

    const newUserMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: content || (filesToSend.length > 0 ? `Please analyze the attached document(s): ${filesToSend.map(f => f.name).join(', ')}` : ''),
      timestamp: Date.now(),
      files: filesToSend.length > 0 ? filesToSend : undefined
    };

    const updatedHistory = [...messages, newUserMessage];
    setMessages(updatedHistory);
    setInput('');
    setLocalFiles([]);
    if (onClearAttachedFiles) onClearAttachedFiles();

    // Prepare assistant message
    const botMessageId = 'bot_' + Date.now();
    const newBotMessage: ChatMessage = {
      id: botMessageId,
      role: 'model',
      content: '',
      timestamp: Date.now(),
      model: selectedModel
    };

    setMessages([...updatedHistory, newBotMessage]);
    setIsStreaming(true);

    try {
      // Filter out welcome message from history payload if needed
      const payloadMessages = updatedHistory
        .filter(m => m.id !== 'welcome')
        .map(m => ({
          role: m.role,
          content: m.content,
          files: m.files
        }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: payloadMessages,
          model: selectedModel,
          role: selectedRole,
        })
      });

      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }

      if (!res.body) throw new Error("No response stream body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';

      while (true) {
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
              const parsed = JSON.parse(dataStr);
              if (parsed.text) {
                accumulatedText += parsed.text;
                setMessages(prev => 
                  prev.map(m => m.id === botMessageId ? { ...m, content: accumulatedText } : m)
                );
              } else if (parsed.error) {
                accumulatedText += `\n\n❌ **Error:** ${parsed.error}`;
                setMessages(prev => 
                  prev.map(m => m.id === botMessageId ? { ...m, content: accumulatedText } : m)
                );
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      console.error("Chat error:", err);
      setMessages(prev => 
        prev.map(m => m.id === botMessageId ? { 
          ...m, 
          content: `❌ **Failed to generate response:** ${err.message || 'Network error'}` 
        } : m)
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExport = () => {
    const md = messages.map(m => {
      const header = m.role === 'user' ? '### 👤 User' : `### 🤖 AgentSamFast (${m.model || 'Gemini'})`;
      return `${header}\n*${new Date(m.timestamp).toLocaleTimeString()}*\n\n${m.content}\n\n---`;
    }).join('\n\n');

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AgentSamFast_Chat_${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearHistory = () => {
    if (confirm("Clear all conversation history?")) {
      setMessages([
        {
          id: 'welcome',
          role: 'model',
          content: `Conversation cleared. How can I assist with your financial research today?`,
          timestamp: Date.now(),
          model: selectedModel
        }
      ]);
    }
  };

  return (
    <div 
      className="flex flex-col h-full w-full max-w-5xl mx-auto overflow-hidden relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleFileDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-stone-900/90 border-2 border-dashed border-emerald-400 z-50 flex flex-col items-center justify-center backdrop-blur-sm pointer-events-none">
          <Paperclip className="w-12 h-12 text-emerald-400 animate-bounce mb-3" />
          <p className="text-lg font-medium text-white">Drop financial files to attach</p>
          <p className="text-xs text-stone-400 mt-1">Supports PDFs, SEC filings, CSVs, spreadsheets, transcripts</p>
        </div>
      )}

      {/* Control Bar: Roles & Models */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-stone-900/70 border-b border-stone-800 backdrop-blur-md shrink-0">
        
        {/* Role Selector */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-xs font-mono uppercase text-stone-400 shrink-0">Role:</span>
          {ROLES.map((r) => {
            const Icon = r.icon;
            const isSelected = selectedRole === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setSelectedRole(r.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all shrink-0 ${
                  isSelected 
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm' 
                    : 'bg-stone-800 text-stone-300 hover:bg-stone-700 border border-stone-700'
                }`}
                title={r.description}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{r.name}</span>
              </button>
            );
          })}
        </div>

        {/* Model & Utility Actions */}
        <div className="flex items-center gap-2">
          {/* Model Selector */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-stone-800 text-stone-200 border border-stone-700 rounded px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-stone-500"
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.tag})
              </option>
            ))}
          </select>

          {/* Export button */}
          <button
            onClick={handleExport}
            className="p-1.5 text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded transition-colors"
            title="Export conversation as Markdown"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* Clear button */}
          <button
            onClick={handleClearHistory}
            className="p-1.5 text-stone-400 hover:text-red-400 hover:bg-stone-800 rounded transition-colors"
            title="Clear Chat History"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div 
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 no-scrollbar min-h-0"
      >
        {messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div 
              key={m.id} 
              className={`flex gap-3 md:gap-4 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
            >
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                isUser 
                  ? 'bg-stone-700 text-white' 
                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              }`}>
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Message Bubble */}
              <div className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                
                {/* Role header & model badge */}
                <div className="flex items-center gap-2 mb-1 text-[11px] font-mono text-stone-400">
                  <span>{isUser ? 'You' : 'AgentSamFast'}</span>
                  {!isUser && m.model && (
                    <span className="px-1.5 py-0.2 bg-stone-800 rounded text-[10px] text-stone-400 border border-stone-700">
                      {m.model}
                    </span>
                  )}
                  <span>• {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                {/* Attached Files Badges */}
                {m.files && m.files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {m.files.map((file, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center gap-1.5 px-2 py-1 rounded bg-stone-800/90 border border-stone-700 text-xs text-stone-300 font-mono"
                      >
                        <FileText className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="truncate max-w-[140px]">{file.name}</span>
                        <span className="text-[10px] text-stone-500">({(file.size / 1024).toFixed(0)}KB)</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Content */}
                <div className={`p-4 rounded-xl text-sm leading-relaxed ${
                  isUser 
                    ? 'bg-stone-800 text-stone-100 border border-stone-700' 
                    : 'bg-stone-900/80 text-stone-200 border border-stone-800/90 shadow-xl'
                }`}>
                  <div className="markdown-body prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-stone-950 prose-pre:border prose-pre:border-stone-800">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                </div>

                {/* Message action buttons */}
                {!isUser && m.content && (
                  <div className="flex items-center gap-2 mt-1.5 pl-1">
                    <button
                      onClick={() => handleCopy(m.content, m.id)}
                      className="text-[11px] text-stone-400 hover:text-stone-200 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-stone-800 transition-colors font-mono"
                    >
                      {copiedId === m.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

              </div>
            </div>
          );
        })}

        {/* Typing indicator while streaming with no text yet */}
        {isStreaming && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex gap-3 max-w-3xl mr-auto">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-1">
              <Bot className="w-4 h-4 animate-pulse" />
            </div>
            <div className="p-4 rounded-xl bg-stone-900/80 border border-stone-800 text-stone-400 text-xs flex items-center gap-2 font-mono">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
              <span>Analyzing financial models & reasoning...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-28 right-6 p-2 rounded-full bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 shadow-lg transition-all z-20"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Bottom Composer Area */}
      <div className="p-4 bg-stone-900/90 border-t border-stone-800 backdrop-blur-md shrink-0">
        
        {/* Starter Prompts when conversation is fresh */}
        {messages.length <= 2 && (
          <div className="mb-3">
            <div className="text-[11px] font-mono text-stone-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-emerald-400" />
              <span>Suggested Financial Questions:</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STARTER_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(prompt)}
                  className="px-2.5 py-1 rounded bg-stone-800/80 hover:bg-stone-700 border border-stone-700 text-stone-300 text-xs text-left transition-all active:scale-95"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Attached Files Preview in composer */}
        {localFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2.5 p-2 bg-stone-800/60 rounded-lg border border-stone-700">
            {localFiles.map((file, index) => (
              <div 
                key={index} 
                className="flex items-center gap-2 px-2.5 py-1 bg-stone-800 rounded border border-stone-600 text-xs text-stone-200"
              >
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <span className="truncate max-w-[180px]">{file.name}</span>
                <span className="text-[10px] text-stone-400">({(file.size / 1024).toFixed(0)}KB)</span>
                <button
                  onClick={() => setLocalFiles(prev => prev.filter((_, i) => i !== index))}
                  className="text-stone-400 hover:text-red-400 transition-colors ml-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input Bar */}
        <div className="bg-stone-800 border border-stone-700 rounded-xl p-1.5 flex items-center gap-2 focus-within:border-stone-500 focus-within:ring-1 focus-within:ring-stone-500 shadow-xl">
          {/* File attach button */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={(e) => e.target.files && processFiles(e.target.files)} 
            multiple 
            accept=".pdf,.csv,.tsv,.txt,.json,.md,.xlsx,.docx"
            className="hidden" 
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-stone-400 hover:text-stone-200 hover:bg-stone-700/60 rounded-lg transition-colors"
            title="Attach financial files (PDF, CSV, spreadsheet, text)"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* Text Input */}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={localFiles.length > 0 ? "Ask questions about attached document(s)..." : "Ask a financial question, ticker inquiry, or drop files here..."}
            disabled={isStreaming}
            className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder-stone-400 px-2"
          />

          {/* Send button */}
          <button
            onClick={() => handleSendMessage()}
            disabled={(!input.trim() && localFiles.length === 0) || isStreaming}
            className="bg-white text-black hover:bg-stone-200 disabled:bg-stone-700 disabled:text-stone-400 disabled:cursor-not-allowed px-4 py-2 rounded-lg font-medium text-xs flex items-center gap-1.5 transition-colors"
          >
            <span>Send</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-stone-400 font-mono">
          <span>AgentSamFast Multi-Turn Financial Chatbot</span>
          <span>Tip: Drop files directly anywhere onto this window</span>
        </div>
      </div>
    </div>
  );
}
