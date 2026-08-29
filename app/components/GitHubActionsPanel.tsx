import React from 'react';
import { Github, PlayCircle, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react';

export const GitHubActionsPanel: React.FC = () => {
    return (
        <div className="w-full h-full bg-[var(--bg-panel)] flex flex-col pt-2 text-main overflow-hidden">
            <div className="px-4 pb-2 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <Github size={14} className="text-main" />
                    <span className="text-[11px] font-bold tracking-widest uppercase text-main">Actions</span>
                </div>
                <button className="p-1 hover:bg-[var(--bg-hover)] rounded" title="Refresh Workflows"><RefreshCw size={12} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                
                {/* Workflow Item 1 */}
                <div className="p-2 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded shadow-sm hover:border-[var(--solar-cyan)] cursor-pointer transition-colors group">
                    <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 size={12} className="text-[var(--solar-green)]" />
                            <span className="text-[12px] font-semibold">Deploy to Workers</span>
                        </div>
                        <span className="text-[10px] text-muted">2m ago</span>
                    </div>
                    <div className="text-[10px] text-muted pl-5 flex items-center justify-between">
                        <span>#42 • main</span>
                        <PlayCircle size={12} className="opacity-0 group-hover:opacity-100 text-[var(--solar-cyan)] transition-opacity" aria-label="Re-run" />
                    </div>
                </div>

                {/* Workflow Item 2 */}
                <div className="p-2 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded shadow-sm hover:border-[var(--solar-red)] cursor-pointer transition-colors group">
                    <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                            <XCircle size={12} className="text-[var(--solar-red)]" />
                            <span className="text-[12px] font-semibold">CI Tests</span>
                        </div>
                        <span className="text-[10px] text-muted">1hr ago</span>
                    </div>
                    <div className="text-[10px] text-muted pl-5 flex items-center justify-between">
                        <span>#41 • feature/excalidraw</span>
                        <PlayCircle size={12} className="opacity-0 group-hover:opacity-100 text-[var(--solar-cyan)] transition-opacity" aria-label="Re-run" />
                    </div>
                </div>

                {/* Workflow Item 3 */}
                <div className="p-2 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded shadow-sm hover:border-[var(--solar-yellow)] cursor-pointer transition-colors group">
                    <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                            <Clock size={12} className="text-[var(--solar-yellow)] animate-pulse" />
                            <span className="text-[12px] font-semibold">Nightly DB Backup</span>
                        </div>
                        <span className="text-[10px] text-muted">In progress</span>
                    </div>
                    <div className="text-[10px] text-muted pl-5">
                        <span>#40 • scheduled</span>
                    </div>
                </div>

            </div>
            
            <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-app)] shrink-0 flex justify-center">
                <button className="text-[10px] bg-[var(--solar-blue)] text-[var(--solar-base03)] px-3 py-1.5 rounded font-semibold w-full flex items-center justify-center gap-1 hover:brightness-110">
                    <Github size={10} /> View on GitHub
                </button>
            </div>
        </div>
    );
};
