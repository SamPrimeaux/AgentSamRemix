import React from 'react';
import { Dumbbell, Eye, Ghost, Moon, Palette, Sun, Zap } from 'lucide-react';
import type { GenerationConfig, SceneConfig } from '../../types';

type Props = {
  genConfig: GenerationConfig;
  onUpdateGenConfig: (config: Partial<GenerationConfig>) => void;
  sceneConfig: SceneConfig;
  onUpdateSceneConfig: (config: Partial<SceneConfig>) => void;
};

const sunPresets = [
  { id: '#00ffff', name: 'Neon', icon: <Zap size={12} /> },
  { id: '#ffcc00', name: 'Sol', icon: <Sun size={12} /> },
  { id: '#ffffff', name: 'Cold', icon: <Moon size={12} /> },
  { id: '#ff3366', name: 'Ghost', icon: <Ghost size={12} /> },
  { id: '#ef4444', name: 'Ruby', icon: <Palette size={12} /> },
  { id: '#10b981', name: 'Emerald', icon: <Palette size={12} /> },
  { id: '#6366f1', name: 'Indigo', icon: <Palette size={12} /> },
  { id: '#0a0a0f', name: 'Void', icon: <Palette size={12} /> },
];

export function MotionTweaksPanel({
  genConfig,
  onUpdateGenConfig,
  sceneConfig,
  onUpdateSceneConfig,
}: Props) {
  return (
    <div className="space-y-4">
      <section className="bg-[var(--bg-hover)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-4">
        <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
          Scene lighting
        </p>
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-[10px] font-bold text-muted uppercase">Ambient</label>
            <span className="text-[10px] font-mono text-amber-400">
              {sceneConfig.ambientIntensity.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={sceneConfig.ambientIntensity}
            onChange={(e) => onUpdateSceneConfig({ ambientIntensity: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-[var(--bg-panel)] rounded-lg accent-amber-500"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-muted uppercase block mb-2">
            Sun color
          </label>
          <div className="grid grid-cols-4 gap-2">
            {sunPresets.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => onUpdateSceneConfig({ sunColor: s.id })}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl border ${
                  sceneConfig.sunColor === s.id
                    ? 'bg-[var(--bg-panel)] border-[var(--solar-cyan)] scale-105'
                    : 'bg-[var(--bg-app)] border-[var(--border-subtle)] opacity-70 hover:opacity-100'
                }`}
                title={s.name}
              >
                <span style={{ color: s.id }}>{s.icon}</span>
                <span className="text-[8px] font-bold text-muted">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between p-3 bg-[var(--bg-panel)] rounded-xl border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Sun
              size={16}
              className={sceneConfig.castShadows ? 'text-amber-400' : 'text-muted'}
            />
            <span className="text-[10px] font-black uppercase text-main">Ray shadows</span>
          </div>
          <button
            type="button"
            onClick={() => onUpdateSceneConfig({ castShadows: !sceneConfig.castShadows })}
            className={`w-10 h-5 rounded-full relative ${
              sceneConfig.castShadows ? 'bg-amber-500' : 'bg-[var(--border-subtle)]'
            }`}
          >
            <span
              className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${
                sceneConfig.castShadows ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
      </section>

      <section className="bg-[var(--bg-hover)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-4">
        <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
          Physics & motion
        </p>
        <div className="flex items-center justify-between p-3 bg-[var(--bg-panel)] rounded-xl border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Dumbbell
              size={16}
              className={genConfig.usePhysics ? 'text-[var(--solar-cyan)]' : 'text-muted'}
            />
            <span className="text-[10px] font-black uppercase text-main">Simulate physics</span>
          </div>
          <button
            type="button"
            onClick={() => onUpdateGenConfig({ usePhysics: !genConfig.usePhysics })}
            className={`w-10 h-5 rounded-full relative ${
              genConfig.usePhysics ? 'bg-[var(--solar-cyan)]' : 'bg-[var(--border-subtle)]'
            }`}
          >
            <span
              className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${
                genConfig.usePhysics ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
        <div className="flex items-center justify-between p-3 bg-[var(--bg-panel)] rounded-xl border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Eye
              size={16}
              className={
                sceneConfig.showPhysicsDebug ? 'text-[var(--solar-cyan)]' : 'text-muted'
              }
            />
            <span className="text-[10px] font-black uppercase text-main">Physics gizmos</span>
          </div>
          <button
            type="button"
            onClick={() => onUpdateSceneConfig({ showPhysicsDebug: !sceneConfig.showPhysicsDebug })}
            className={`w-10 h-5 rounded-full relative ${
              sceneConfig.showPhysicsDebug ? 'bg-[var(--solar-cyan)]' : 'bg-[var(--border-subtle)]'
            }`}
          >
            <span
              className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${
                sceneConfig.showPhysicsDebug ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-[10px] font-bold text-muted uppercase">
              Voxel density
            </label>
            <span className="text-[10px] font-mono text-[var(--solar-cyan)]">{genConfig.density}/10</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={genConfig.density}
            onChange={(e) => onUpdateGenConfig({ density: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-[var(--bg-panel)] rounded-lg accent-[var(--solar-cyan)]"
          />
        </div>
      </section>
    </div>
  );
}
