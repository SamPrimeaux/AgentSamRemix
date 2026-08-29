import React from 'react';
import { Sparkles } from 'lucide-react';
import { IAM_LOGO_URL } from './movieModeRoutes';

type Props = {
  title: string;
  subtitle: string;
};

export function MovieModePlaceholderTab({ title, subtitle }: Props) {
  return (
    <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 px-6 bg-[var(--dashboard-canvas)] text-center">
      <img src={IAM_LOGO_URL} alt="" className="h-10 w-10 rounded-lg opacity-80" aria-hidden />
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)] text-[var(--solar-cyan)]">
        <Sparkles size={28} />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-main">{title}</h2>
        <p className="text-sm text-muted mt-1 max-w-xs">{subtitle}</p>
      </div>
    </div>
  );
}
