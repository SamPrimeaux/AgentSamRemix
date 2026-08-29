// Used by DesignStudioPage.tsx for CAD toolbar / HUD overlays.

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { AppState, ProjectType, GenerationConfig, CADTool, CADPlane } from '../types';
import { 
  Box, Loader2, Info, Activity, Zap, Mountain, Trees, LayoutGrid, 
  Minus, Square, Circle, MousePointer2, Paintbrush, Layers, Maximize2,
  Undo2, Redo2, Trash2, Box as CubeIcon, Disc, ChevronUp, Construction
} from 'lucide-react';
import { MeshyBalancePill } from './designstudio/MeshyBalancePill';

interface UIOverlayProps {
  entityCount: number;
  appState: AppState;
  activeProject: ProjectType;
  isGenerating: boolean;
  onTogglePlay: () => void;
  onClear: () => void;
  genConfig: GenerationConfig;
  onUpdateGenConfig: (cfg: Partial<GenerationConfig>) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Minimal chrome for Design Studio creation station viewport */
  variant?: 'default' | 'studio';
}

export const UIOverlay: React.FC<UIOverlayProps> = ({
  entityCount,
  activeProject,
  isGenerating,
  onClear,
  genConfig,
  onUpdateGenConfig,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  variant = 'default',
}) => {
  const getStyleIcon = () => {
    switch (genConfig.style) {
      case 'CYBERPUNK': return <Zap size={10} />;
      case 'BRUTALIST': return <Mountain size={10} />;
      case 'ORGANIC': return <Trees size={10} />;
      default: return <LayoutGrid size={10} />;
    }
  };

  const cadTools = [
    { id: CADTool.NONE, icon: <MousePointer2 size={16} />, label: 'Orbit' },
    { id: CADTool.VOXEL, icon: <Construction size={16} />, label: 'Block' },
    { id: CADTool.PAINT, icon: <Paintbrush size={16} />, label: 'Paint' },
    { id: CADTool.LINE, icon: <Minus size={16} />, label: 'Line' },
    { id: CADTool.RECTANGLE, icon: <Square size={16} />, label: 'Rect' },
    { id: CADTool.CIRCLE, icon: <Circle size={16} />, label: 'Circle' },
    { id: CADTool.CUBE, icon: <CubeIcon size={16} />, label: 'Cube' },
    { id: CADTool.SPHERE, icon: <Disc size={16} />, label: 'Sphere' },
    { id: CADTool.CONE, icon: <ChevronUp size={16} />, label: 'Cone' },
  ];

  const planes = [
    { id: CADPlane.XZ, label: 'Ground (XZ)' },
    { id: CADPlane.XY, label: 'Front (XY)' },
    { id: CADPlane.YZ, label: 'Side (YZ)' },
  ];

  if (variant === 'studio') {
    return (
      <div className="absolute inset-0 pointer-events-none p-3 md:p-4">
        <div className="flex justify-end items-start gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="w-9 h-9 rounded-lg bg-black/50 border border-white/10 text-zinc-400 hover:text-white disabled:opacity-25 backdrop-blur-md"
            title="Undo"
          >
            <Undo2 size={16} className="mx-auto" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className="w-9 h-9 rounded-lg bg-black/50 border border-white/10 text-zinc-400 hover:text-white disabled:opacity-25 backdrop-blur-md"
            title="Redo"
          >
            <Redo2 size={16} className="mx-auto" />
          </button>
          <button
            type="button"
            onClick={onClear}
            className="px-3 h-9 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-[10px] font-bold uppercase tracking-wide backdrop-blur-md hover:bg-red-500/20"
          >
            Purge
          </button>
        </div>
        {isGenerating && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-black/70 border border-emerald-500/20 backdrop-blur-xl">
              <Loader2 size={20} className="text-emerald-400 animate-spin" />
              <span className="text-[11px] font-semibold text-zinc-200">Generating mesh…</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none p-10 flex flex-col justify-between">
      
      {/* Top HUD */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4 bg-black/40 backdrop-blur-xl border border-white/5 px-6 py-4 rounded-2xl shadow-2xl">
                <div className="p-2 bg-cyan-500/10 text-cyan-400 rounded-lg animate-pulse">
                    <Activity size={20} />
                </div>
                <div>
                    <h2 className="text-xs font-black tracking-widest uppercase text-white/90">{activeProject.replace('_', ' ')}</h2>
                    <div className="flex items-center gap-4 mt-1">
                        <div className="flex items-center gap-1.5">
                            <Box size={10} className="text-cyan-500" />
                            <span className="text-[10px] font-mono text-cyan-500/80 uppercase">{entityCount} OBJECTS</span>
                        </div>
                        <div className="h-1 w-1 bg-white/10 rounded-full" />
                        <div className="flex items-center gap-1.5">
                            {getStyleIcon()}
                            <span className="text-[10px] font-mono text-white/40 uppercase">{genConfig.style} MODE</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* CAD Toolbar */}
            {activeProject === ProjectType.CAD && (
              <div className="flex flex-col gap-2 pointer-events-auto animate-in slide-in-from-left duration-500">
                <div className="flex items-center gap-2 bg-black/60 backdrop-blur-2xl border border-white/10 p-2 rounded-2xl shadow-2xl overflow-x-auto max-w-[500px] scrollbar-hide">
                  {cadTools.map(tool => (
                    <button
                      key={tool.id}
                      onClick={() => onUpdateGenConfig({ cadTool: tool.id })}
                      className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all shrink-0 ${
                        genConfig.cadTool === tool.id 
                        ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' 
                        : 'text-white/40 hover:text-white hover:bg-white/5'
                      }`}
                      title={tool.label}
                    >
                      {tool.icon}
                      <span className="text-[8px] font-black uppercase tracking-tighter">{tool.label}</span>
                    </button>
                  ))}
                  <div className="w-px h-10 bg-white/10 mx-1 shrink-0" />
                  <button
                    onClick={onUndo}
                    disabled={!canUndo}
                    className="p-3 rounded-xl flex flex-col items-center gap-1 text-white/40 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent transition-all shrink-0"
                    title="Undo (Ctrl+Z)"
                  >
                    <Undo2 size={16} />
                    <span className="text-[8px] font-black uppercase tracking-tighter">Undo</span>
                  </button>
                  <button
                    onClick={onRedo}
                    disabled={!canRedo}
                    className="p-3 rounded-xl flex flex-col items-center gap-1 text-white/40 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent transition-all shrink-0"
                    title="Redo (Ctrl+Y)"
                  >
                    <Redo2 size={16} />
                    <span className="text-[8px] font-black uppercase tracking-tighter">Redo</span>
                  </button>
                </div>

                {genConfig.cadTool !== CADTool.NONE && genConfig.cadTool !== CADTool.PAINT && genConfig.cadTool !== CADTool.VOXEL && (
                  <div className="flex flex-col gap-2 bg-black/60 backdrop-blur-2xl border border-white/10 p-4 rounded-2xl shadow-2xl min-w-[200px]">
                    <div className="flex items-center gap-2 mb-2">
                       <Layers size={12} className="text-cyan-400" />
                       <span className="text-[10px] font-black text-white/60 uppercase">Plane Selection</span>
                    </div>
                    <div className="flex gap-2">
                      {planes.map(p => (
                        <button
                          key={p.id}
                          onClick={() => onUpdateGenConfig({ cadPlane: p.id })}
                          className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase border transition-all ${
                            genConfig.cadPlane === p.id 
                            ? 'bg-white text-black border-white' 
                            : 'bg-white/5 text-white/40 border-white/5 hover:border-white/20'
                          }`}
                        >
                          {p.id}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4">
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-2">
                          <Maximize2 size={12} className="text-cyan-400" />
                          <span className="text-[10px] font-black text-white/60 uppercase tracking-tighter">
                            {genConfig.cadTool === CADTool.SPHERE ? 'Scale Factor' : 'Extrusion / Height'}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-cyan-400">{genConfig.extrusion}</span>
                      </div>
                      <input 
                        type="range"
                        min="1"
                        max="30"
                        step="1"
                        value={genConfig.extrusion}
                        onChange={(e) => onUpdateGenConfig({ extrusion: parseInt(e.target.value) })}
                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>

        <div className="flex gap-4 pointer-events-auto items-start">
            {activeProject === ProjectType.CAD && <MeshyBalancePill />}
            {!activeProject.includes('CAD') && (
              <>
                <button
                  onClick={onUndo}
                  disabled={!canUndo}
                  className="w-10 h-10 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center text-white/40 hover:text-white disabled:opacity-20 transition-all"
                  title="Undo"
                >
                  <Undo2 size={18} />
                </button>
                <button
                  onClick={onRedo}
                  disabled={!canRedo}
                  className="w-10 h-10 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center text-white/40 hover:text-white disabled:opacity-20 transition-all"
                  title="Redo"
                >
                  <Redo2 size={18} />
                </button>
              </>
            )}
            <button 
                onClick={onClear}
                className="px-6 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all flex items-center gap-2"
            >
                <Trash2 size={14} />
                Purge Scene
            </button>
            <div className="w-10 h-10 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center text-white/40 hover:text-white transition-colors cursor-pointer">
                <Info size={18} />
            </div>
        </div>
      </div>

      {/* Generation Feedback */}
      {isGenerating && (
          <div className="self-center flex flex-col items-center gap-6 bg-black/60 backdrop-blur-3xl p-10 rounded-3xl border border-white/10 shadow-[0_0_80px_rgba(0,0,0,0.8)]">
              <div className="relative">
                  <div className="absolute -inset-4 bg-cyan-500/20 rounded-full blur-xl animate-pulse"></div>
                  <Loader2 size={48} className="text-cyan-400 animate-spin relative" />
              </div>
              <div className="text-center">
                  <div className="text-white text-sm font-black uppercase tracking-[0.3em]">AI Architecting</div>
                  <div className="text-[10px] text-cyan-500 font-mono mt-2 tracking-widest uppercase italic">Applying {genConfig.style} Rules</div>
                  <div className="mt-4 h-1 w-48 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500 animate-[loading_2s_ease-in-out_infinite]"></div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
