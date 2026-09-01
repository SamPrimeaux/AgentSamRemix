import React, { useState, useEffect } from 'react';
import { 
  X, 
  ChevronLeft, 
  ChevronRight, 
  Maximize2, 
  Minimize2, 
  Check, 
  Sparkles, 
  Download, 
  Layers
} from 'lucide-react';
import { PresentationDeck } from '../types';
import { cn } from '../../lib/utils';
import confetti from 'canvas-confetti';

interface PresentationModalProps {
  isOpen: boolean;
  onClose: () => void;
  deck: PresentationDeck;
}

export const PresentationModal: React.FC<PresentationModalProps> = ({
  isOpen,
  onClose,
  deck
}) => {
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'ArrowRight' || e.key === 'Space') {
        setSlideIndex((prev) => Math.min(deck.slides.length - 1, prev + 1));
      } else if (e.key === 'ArrowLeft') {
        setSlideIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, deck.slides.length, onClose]);

  if (!isOpen) return null;

  const currentSlide = deck.slides[slideIndex] || deck.slides[0];

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col justify-between p-4 sm:p-10 select-none animate-in fade-in duration-200">
      {/* Top Bar Controls */}
      <div className="flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
          <div>
            <h3 className="font-extrabold text-sm sm:text-base tracking-tight">{deck.title}</h3>
            <div className="text-xs text-zinc-400 font-mono">
              Slide {slideIndex + 1} of {deck.slides.length} • Client Presenter Mode
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              confetti({ particleCount: 50, spread: 80 });
            }}
            className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Sparkles size={13} className="text-amber-400" />
            <span>Celebrate Pitch</span>
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Slide Stage */}
      <div className="max-w-5xl w-full mx-auto my-auto aspect-[16/10] sm:aspect-[16/9] bg-zinc-950 rounded-3xl border border-zinc-800 p-8 sm:p-16 flex flex-col justify-between relative shadow-2xl overflow-hidden">
        {/* Accent strip */}
        <div 
          className="absolute top-0 left-0 right-0 h-2"
          style={{ backgroundColor: currentSlide.accentColor || '#10b981' }}
        />

        {/* Slide Header */}
        <div>
          <div className="inline-block px-3 py-1 rounded-full bg-zinc-800 text-zinc-300 text-xs font-bold uppercase tracking-wider mb-4">
            {currentSlide.badge || 'Executive Presentation'}
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
            {currentSlide.title}
          </h1>
          {currentSlide.subtitle && (
            <p className="text-sm sm:text-lg text-zinc-400 mt-2 max-w-3xl">
              {currentSlide.subtitle}
            </p>
          )}
        </div>

        {/* Slide Body */}
        <div className="my-6 space-y-3">
          {currentSlide.bullets.map((bullet, idx) => (
            <div key={idx} className="flex items-start gap-3 text-sm sm:text-base text-zinc-200">
              <span 
                className="w-2.5 h-2.5 rounded-full mt-2 shrink-0" 
                style={{ backgroundColor: currentSlide.accentColor || '#10b981' }}
              />
              <span>{bullet}</span>
            </div>
          ))}

          {currentSlide.quote && (
            <div className="p-4 rounded-2xl bg-zinc-900 border-l-4 border-blue-500 italic text-sm text-zinc-300">
              "{currentSlide.quote.text}"
              <div className="not-italic font-semibold text-xs text-zinc-400 mt-1">
                — {currentSlide.quote.author}
              </div>
            </div>
          )}
        </div>

        {/* Slide Metrics Footer */}
        {currentSlide.metrics && currentSlide.metrics.length > 0 && (
          <div className="grid grid-cols-3 gap-4 pt-6 border-t border-zinc-800">
            {currentSlide.metrics.map((m, idx) => (
              <div key={idx} className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800">
                <div className="text-xs text-zinc-400 font-medium">{m.label}</div>
                <div className="text-xl sm:text-3xl font-extrabold text-white mt-0.5">{m.value}</div>
                {m.trend && <div className="text-xs text-emerald-400 font-semibold mt-1">{m.trend}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Navigation Controls */}
      <div className="flex items-center justify-between max-w-5xl w-full mx-auto pt-4 text-xs text-zinc-400">
        <div>Use Left / Right arrow keys to navigate slides</div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setSlideIndex((prev) => Math.max(0, prev - 1))}
            disabled={slideIndex === 0}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white disabled:opacity-30 flex items-center gap-1.5 transition-colors font-semibold"
          >
            <ChevronLeft size={16} />
            <span>Previous</span>
          </button>
          
          <button
            onClick={() => setSlideIndex((prev) => Math.min(deck.slides.length - 1, prev + 1))}
            disabled={slideIndex === deck.slides.length - 1}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-30 flex items-center gap-1.5 transition-colors font-semibold shadow-md"
          >
            <span>Next</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
