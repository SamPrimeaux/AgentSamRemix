import React, { useState, useEffect } from 'react';
import { Search, Settings2, RefreshCw, Layers } from 'lucide-react';

export interface MCPTool {
    id: string;
    mcp_name: string;
    feature_name: string;
    description: string;
    version: string;
    status: string;
    schema: string;
}

interface Props {
  onToolSelect: (tool: MCPTool) => void;
}

export const ExtensionsPanel: React.FC<Props> = ({ onToolSelect }) => {
    const [tools, setTools] = useState<MCPTool[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    const fetchTools = () => {
        setLoading(true);
        fetch('/api/mcp/tools', { credentials: 'same-origin' })
            .then(res => res.json())
            .then((data: { tools?: Array<{ tool_name: string; description?: string; category?: string }> }) => {
                const rows = Array.isArray(data.tools) ? data.tools : [];
                setTools(
                    rows.map(t => ({
                        id: t.tool_name,
                        mcp_name: t.tool_name,
                        feature_name: t.tool_name,
                        description: t.description || '',
                        version: '1',
                        status: 'active',
                        schema: '{}',
                    }))
                );
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchTools();
    }, []);

    const filtered = tools.filter(t => 
        t.mcp_name?.toLowerCase().includes(search.toLowerCase()) || 
        t.description?.toLowerCase().includes(search.toLowerCase()) ||
        t.feature_name?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="flex flex-col h-full bg-[var(--bg-panel)] w-full text-main overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 shrink-0">
                <span className="text-[11px] font-semibold tracking-widest uppercase text-muted">Integrations</span>
                <div className="flex gap-2 text-muted">
                    <RefreshCw size={14} className="hover:text-white cursor-pointer" onClick={fetchTools} />
                    <Settings2 size={14} className="hover:text-white cursor-pointer" />
                </div>
            </div>

            <div className="px-4 pb-2 shrink-0">
                <div className="relative flex items-center bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded shadow-inner p-1">
                    <Search size={14} className="text-muted ml-1.5 absolute" />
                    <input 
                        type="text"
                        placeholder="Search capabilities..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full bg-transparent pl-7 pr-2 py-1 text-[12px] focus:outline-none placeholder:text-muted"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto mt-2 pb-4">
                {loading ? (
                    <div className="p-4 text-xs text-muted flex justify-center animate-pulse">Scanning schema indexes...</div>
                ) : filtered.length === 0 ? (
                    <div className="p-4 text-xs text-muted">No active tool bindings.</div>
                ) : (
                    <div className="flex flex-col">
                        {filtered.map(tool => (
                            <div 
                                key={tool.id} 
                                onClick={() => onToolSelect(tool)}
                                className="px-4 py-3 hover:bg-[var(--bg-hover)] cursor-pointer border-b border-[var(--border-subtle)]/30 group transition-colors"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 text-[var(--solar-cyan)] group-hover:text-white transition-colors shrink-0">
                                        <Layers size={18} />
                                    </div>
                                    <div className="flex flex-col gap-1 overflow-hidden min-w-0 w-full">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[13px] font-medium truncate text-white">{tool.feature_name || tool.mcp_name}</span>
                                            {tool.status === 'active' && <div className="w-1.5 h-1.5 rounded-full bg-[var(--solar-green)] shrink-0" title="Active Socket" />}
                                            {tool.status !== 'active' && <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] shrink-0 opacity-50" />}
                                        </div>
                                        <span className="text-[11px] text-muted line-clamp-2 leading-relaxed" title={tool.description}>{tool.description}</span>
                                        <span className="text-[10px] text-[var(--solar-blue)] mt-1 font-mono truncate">{tool.mcp_name} v{tool.version || '1.0'}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
