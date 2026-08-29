import React from 'react';

export type ThemeSwatchesProps = {
  colors: string[];
  size?: number;
};

export function ThemeSwatches({ colors, size = 14 }: ThemeSwatchesProps): React.ReactElement {
  const list = colors.filter(Boolean).slice(0, 8);
  return (
    <div className="flex gap-1 flex-wrap" aria-hidden>
      {list.map((c, i) => (
        <span
          key={`${c}-${i}`}
          title={c}
          className="rounded-sm border border-black/10 shrink-0"
          style={{
            width: size,
            height: size,
            background: c,
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
          }}
        />
      ))}
    </div>
  );
}
