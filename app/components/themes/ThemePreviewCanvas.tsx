import React from 'react';

export type PreviewModel = {
  canvas?: string;
  nav?: string;
  shell?: string;
  surface?: string;
  panel?: string;
  text?: string;
  textSecondary?: string;
  muted?: string;
  primary?: string;
  monacoBg?: string;
  monacoText?: string;
  radius?: string;
  swatches?: string[];
};

export type ThemePreviewCanvasProps = {
  model: PreviewModel;
  height?: number;
};

export function ThemePreviewCanvas({ model, height = 112 }: ThemePreviewCanvasProps): React.ReactElement {
  const canvas = model.canvas || '#f8fafc';
  const nav = model.nav || model.shell || canvas;
  const panel = model.panel || model.surface || '#ffffff';
  const text = model.text || '#0f172a';
  const muted = model.muted || model.textSecondary || '#64748b';
  const primary = model.primary || '#0ea5e9';
  const monacoBg = model.monacoBg || '#182433';
  const monacoText = model.monacoText || '#e2e8f0';
  const radius = model.radius || '6px';

  return (
    <div
      className="overflow-hidden border border-black/10"
      style={{
        height,
        borderRadius: radius,
        background: canvas,
        display: 'grid',
        gridTemplateRows: '22px 1fr',
      }}
    >
      <div
        className="flex items-center px-2 text-[9px] font-medium truncate"
        style={{ background: nav, color: muted, borderBottom: '1px solid rgba(0,0,0,0.06)' }}
      >
        Nav
      </div>
      <div className="grid grid-cols-[1fr_38%] min-h-0">
        <div className="p-1.5 font-mono text-[8px] leading-snug" style={{ background: monacoBg, color: monacoText }}>
          editor
          <br />
          <span style={{ opacity: 0.65 }}>muted</span>
        </div>
        <div className="p-1.5 flex flex-col gap-1" style={{ background: panel, borderLeft: '1px solid rgba(0,0,0,0.06)' }}>
          <div className="text-[8px] font-semibold truncate" style={{ color: text }}>
            Panel
          </div>
          <div className="text-[7px] leading-tight" style={{ color: muted }}>
            Secondary copy
          </div>
          <div
            className="mt-auto text-[8px] px-1.5 py-0.5 rounded inline-block self-start font-medium text-white"
            style={{ background: primary }}
          >
            Action
          </div>
        </div>
      </div>
    </div>
  );
}
