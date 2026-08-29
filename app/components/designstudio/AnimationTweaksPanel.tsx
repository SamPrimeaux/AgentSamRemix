import React from 'react';
import { LayoutGrid, Mountain, Sparkles, Sword, Trees, Zap } from 'lucide-react';
import { ArtStyle, type GenerationConfig } from '../../types';
import { chessPieceGlbPath } from '@inneranimalmedia/client-3d-runtime/assets';

type Props = {
  genConfig: GenerationConfig;
  onUpdateGenConfig: (config: Partial<GenerationConfig>) => void;
  onSpawnModel: (name: string, url: string, scale: number) => void;
};

const styles = [
  { id: ArtStyle.CYBERPUNK, name: 'Cyberpunk', icon: <Zap size={14} />, colors: 'from-cyan-500 to-blue-600' },
  { id: ArtStyle.BRUTALIST, name: 'Brutalist', icon: <Mountain size={14} />, colors: 'from-slate-600 to-slate-800' },
  { id: ArtStyle.ORGANIC, name: 'Organic', icon: <Trees size={14} />, colors: 'from-emerald-500 to-teal-600' },
  { id: ArtStyle.LOW_POLY, name: 'Low-Poly', icon: <LayoutGrid size={14} />, colors: 'from-amber-400 to-orange-500' },
];

const ARMORY_PIECES = [
  { type: 'king',   name: 'King' },
  { type: 'queen',  name: 'Queen' },
  { type: 'rook',   name: 'Rook' },
  { type: 'bishop', name: 'Bishop' },
  { type: 'knight', name: 'Knight' },
  { type: 'pawn',   name: 'Pawn' },
] as const;

/** Minimal SVG silhouettes for each piece — differentiated at 20px. */
function PieceIcon({ type, color }: { type: string; color: string }) {
  const c = color;
  switch (type) {
    case 'king':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="8.5" y="1" width="3" height="4" rx="0.5" fill={c} />
          <rect x="6" y="3" width="8" height="2" rx="0.5" fill={c} />
          <rect x="5" y="6" width="10" height="9" rx="1" fill={c} />
          <rect x="4" y="15" width="12" height="3" rx="0.5" fill={c} />
        </svg>
      );
    case 'queen':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="5" cy="4" r="2" fill={c} />
          <circle cx="10" cy="2.5" r="2" fill={c} />
          <circle cx="15" cy="4" r="2" fill={c} />
          <path d="M4 6 L5 14 L15 14 L16 6 L10 10 Z" fill={c} />
          <rect x="4" y="14" width="12" height="3" rx="0.5" fill={c} />
        </svg>
      );
    case 'rook':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="4" y="2" width="3" height="4" rx="0.5" fill={c} />
          <rect x="8.5" y="2" width="3" height="4" rx="0.5" fill={c} />
          <rect x="13" y="2" width="3" height="4" rx="0.5" fill={c} />
          <rect x="5" y="6" width="10" height="9" rx="1" fill={c} />
          <rect x="4" y="15" width="12" height="3" rx="0.5" fill={c} />
        </svg>
      );
    case 'bishop':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="3" r="2" fill={c} />
          <ellipse cx="10" cy="10" rx="4" ry="7" fill={c} />
          <rect x="4" y="15" width="12" height="3" rx="0.5" fill={c} />
        </svg>
      );
    case 'knight':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M6 18 L6 12 C6 8 8 5 13 3 C14 5 13 7 11 8 L14 10 L12 14 L6 18 Z" fill={c} />
          <rect x="4" y="15" width="12" height="3" rx="0.5" fill={c} />
        </svg>
      );
    case 'pawn':
    default:
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="4" r="3" fill={c} />
          <rect x="7.5" y="7" width="5" height="8" rx="1" fill={c} />
          <rect x="5" y="15" width="10" height="3" rx="0.5" fill={c} />
        </svg>
      );
  }
}

export function AnimationTweaksPanel({ genConfig, onUpdateGenConfig, onSpawnModel }: Props) {
  const chessPieces = ARMORY_PIECES.map((p) => ({
    type: p.type,
    name: p.name,
    white_url: chessPieceGlbPath('white', p.type),
    black_url: chessPieceGlbPath('black', p.type),
  }));

  return (
    <div className="space-y-4">
      <section className="bg-[var(--bg-hover)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--solar-violet)]" />
          <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
            Art direction
          </p>
        </div>
        <div>
          <label className="text-[10px] font-bold text-muted uppercase block mb-2">
            Scene style preset
          </label>
          <div className="grid grid-cols-2 gap-2">
            {styles.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => onUpdateGenConfig({ style: s.id })}
                className={`flex items-center gap-2 p-2 rounded-xl border text-[10px] font-black ${
                  genConfig.style === s.id
                    ? `bg-gradient-to-br ${s.colors} text-white border-transparent`
                    : 'bg-[var(--bg-panel)] border-[var(--border-subtle)] text-muted'
                }`}
              >
                {s.icon}
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--bg-hover)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-3">
        <div className="flex items-center gap-2">
          <Sword size={14} className="text-[var(--solar-violet)]" />
          <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
            Character armory
          </p>
        </div>
        <p className="text-[9px] text-muted">
          Drop chess pieces into the scene for games and motion tests.
        </p>
        <div>
          <p className="text-[9px] font-bold text-muted uppercase mb-2">White pieces</p>
          <div className="grid grid-cols-3 gap-2">
            {chessPieces.map((piece) => (
              <button
                type="button"
                key={`white-${piece.type}`}
                onClick={() => onSpawnModel(`White ${piece.name}`, piece.white_url, 0.8)}
                className="flex flex-col items-center gap-1 p-2 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] hover:border-[var(--solar-cyan)] transition-colors"
              >
                <PieceIcon type={piece.type} color="var(--text-muted)" />
                <span className="text-[8px] font-black uppercase text-muted">{piece.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[9px] font-bold text-muted uppercase mb-2">Orange pieces</p>
          <div className="grid grid-cols-3 gap-2">
            {chessPieces.map((piece) => (
              <button
                type="button"
                key={`orange-${piece.type}`}
                onClick={() => onSpawnModel(`Orange ${piece.name}`, piece.black_url, 0.8)}
                className="flex flex-col items-center gap-1 p-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] hover:border-[var(--solar-violet)] transition-colors"
              >
                <PieceIcon type={piece.type} color="var(--solar-violet)" />
                <span className="text-[8px] font-black uppercase text-muted">{piece.name}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
