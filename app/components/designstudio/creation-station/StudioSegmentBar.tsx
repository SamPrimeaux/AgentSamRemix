import React from 'react';
import { STUDIO_SEGMENTS, type StudioSegment, persistStudioSegment } from './meshyToolkitTypes';

type Props = {
  active: StudioSegment;
  onChange: (seg: StudioSegment) => void;
};

export function StudioSegmentBar({ active, onChange }: Props) {
  return (
    <div
      className="flex gap-1 p-1 rounded-xl shrink-0"
      style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}
    >
      {STUDIO_SEGMENTS.map((seg) => {
        const on = active === seg.id;
        return (
          <button
            key={seg.id}
            type="button"
            onClick={() => {
              persistStudioSegment(seg.id);
              onChange(seg.id);
            }}
            className="flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-[0.1em] cursor-pointer transition-colors"
            style={{
              border: 'none',
              background: on ? 'color-mix(in srgb, var(--solar-cyan) 14%, transparent)' : 'transparent',
              color: on ? 'var(--solar-cyan)' : 'var(--text-muted)',
            }}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
