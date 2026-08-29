import React, { useEffect, useState } from 'react';
import { Layers, Play, CheckCircle2, AlertCircle, Loader2, Info } from 'lucide-react';

interface MCPTool {
  id: string;
  tool_name: string;
  tool_category: string;
  description: string;
  enabled: number;
  input_schema: string;
}

export const MCPPanel: React.FC = () => {
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [invoking, setInvoking] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any>>({});

  useEffect(() => {
    fetch('/api/mcp/tools', { credentials: 'same-origin' })
      .then(res => res.json())
      .then((data: { tools?: Array<{ tool_name: string; description?: string; category?: string }> }) => {
        const rows = Array.isArray(data.tools) ? data.tools : [];
        setTools(
          rows.map(t => ({
            id: t.tool_name,
            tool_name: t.tool_name,
            tool_category: t.category || 'general',
            description: t.description || '',
            enabled: 1,
            input_schema: '{}',
          }))
        );
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const invokeTool = async (tool: MCPTool) => {
    setInvoking(tool.id);
    try {
      const resp = await fetch('/api/mcp/catalog-invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          tool_name: tool.tool_name,
          params: {},
        }),
      });
      const data = await resp.json();
      setResults(prev => ({ ...prev, [tool.id]: data }));
    } catch (err: any) {
      setResults(prev => ({ ...prev, [tool.id]: { error: err.message } }));
    } finally {
      setInvoking(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted">
        <Loader2 className="animate-spin mr-2" size={16} />
        <span>Loading MCP Tools...</span>
      </div>
    );
  }

  const categories = Array.from(new Set(tools.map(t => t.tool_category)));

  return (
    <div className="flex flex-col h-full bg-[var(--bg-panel)] overflow-hidden">
      <div className="p-4 border-b border-[var(--border-subtle)]">
        <h3 className="text-[12px] font-bold text-[var(--text-heading)] uppercase tracking-widest">MCP Tool Browser</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {categories.map(cat => (
          <div key={cat} className="mb-6">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--solar-cyan)] mb-3 flex items-center gap-2">
              <Layers size={12} /> {cat}
            </h4>
            <div className="flex flex-col gap-2">
              {tools.filter(t => t.tool_category === cat).map(tool => (
                <div key={tool.id} className="p-3 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl hover:border-[var(--solar-cyan)]/30 transition-all">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="text-[12px] font-semibold text-main">{tool.tool_name}</div>
                      <p className="text-[11px] text-muted mt-1">{tool.description}</p>
                    </div>
                    <button
                      onClick={() => invokeTool(tool)}
                      disabled={invoking === tool.id}
                      className={`p-2 rounded-lg transition-colors ${
                        invoking === tool.id 
                          ? 'bg-[var(--bg-hover)] text-muted' 
                          : 'bg-[var(--solar-cyan)]/10 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/20'
                      }`}
                    >
                      {invoking === tool.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                    </button>
                  </div>
                  
                  {results[tool.id] && (
                    <div className="mt-3 p-2 bg-[var(--scene-bg)] border border-[var(--border-subtle)] rounded-lg font-mono text-[10px] overflow-hidden">
                      <div className="flex items-center gap-1.5 mb-1 text-muted uppercase tracking-tighter">
                        {results[tool.id].error ? <AlertCircle size={10} className="text-red-400" /> : <CheckCircle2 size={10} className="text-green-400" />}
                        Result
                      </div>
                      <pre className="whitespace-pre-wrap break-all text-main">
                        {JSON.stringify(results[tool.id], null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
