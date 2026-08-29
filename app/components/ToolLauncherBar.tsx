import React, { useEffect, useRef, useState } from 'react';
import { Box, Download, Triangle, Upload, Wand2 } from 'lucide-react';
import { ProjectType } from '../types';

interface ToolLauncherBarProps {
  activeProject?: ProjectType;
  onNavigate?: (url: string) => void;
  onImportGlb?: (file: File) => void;
  onMeshyGenerate?: (prompt: string) => void | Promise<unknown>;
  latestGlbUrl?: string | null;
  onDownloadGlb?: () => void;
}

export const ToolLauncherBar: React.FC<ToolLauncherBarProps> = ({
  activeProject = ProjectType.SANDBOX,
  onNavigate,
  onImportGlb,
  onMeshyGenerate,
  latestGlbUrl,
  onDownloadGlb,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusWrapRef = useRef<HTMLDivElement>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const isCad = activeProject === ProjectType.CAD;

  useEffect(() => {
    if (!plusOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (plusWrapRef.current && !plusWrapRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [plusOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onImportGlb) onImportGlb(file);
    e.target.value = '';
  };

  const handleMeshyClick = () => {
    if (onMeshyGenerate) {
      const prompt = window.prompt('Meshy: describe your 3D model');
      if (prompt?.trim()) void onMeshyGenerate(prompt.trim());
      return;
    }
    onNavigate?.('https://app.meshy.ai');
  };

  return (
    <div className="pointer-events-auto">
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-full border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/90 backdrop-blur-xl shadow-2xl glass-panel-overlay">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center p-2 rounded-full hover:bg-[var(--bg-hover)] text-[var(--solar-cyan)] transition-all group relative"
          title="Import GLB Model"
        >
          <Upload size={16} />
        </button>
        <input ref={fileInputRef} type="file" accept=".glb" onChange={handleFileChange} className="hidden" />

        <div className="w-px h-4 bg-[var(--dashboard-border)] mx-0.5" />

        {isCad ? (
          <>
            <button
              type="button"
              onClick={handleMeshyClick}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-[var(--bg-hover)] transition-all border border-transparent hover:border-[var(--dashboard-border)]"
              title="In-app Meshy generate"
            >
              <Box size={16} className="text-[var(--solar-cyan)]" />
              <span className="text-[11px] font-bold text-muted">Meshy</span>
            </button>
            {latestGlbUrl && onDownloadGlb ? (
              <button
                type="button"
                onClick={onDownloadGlb}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-[var(--bg-hover)] transition-all border border-transparent hover:border-[var(--dashboard-border)]"
                title="Download latest CAD GLB"
              >
                <Download size={16} className="text-[var(--solar-orange)]" />
                <span className="text-[11px] font-bold text-muted">Export GLB</span>
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onNavigate?.('https://app.meshy.ai')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-[var(--bg-hover)] transition-all"
            >
              <Box size={16} className="text-[var(--solar-cyan)]" />
              <span className="text-[11px] font-bold text-muted">Meshy</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('https://app.spline.design')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-[var(--bg-hover)] transition-all"
            >
              <Wand2 size={16} className="text-[var(--solar-blue)]" />
              <span className="text-[11px] font-bold text-muted">Spline</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('https://www.blender.org/download')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-[var(--bg-hover)] transition-all"
            >
              <Triangle size={16} className="text-[var(--solar-orange)]" />
              <span className="text-[11px] font-bold text-muted">Blender</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
