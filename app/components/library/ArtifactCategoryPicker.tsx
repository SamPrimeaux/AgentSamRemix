import { X } from 'lucide-react';
import { ARTIFACT_CATEGORIES } from '../../config/artifactCategories';
import { startArtifactFromCategory } from '../../lib/artifactChat';

type Props = {
  open: boolean;
  onClose: () => void;
  onStarted?: (title: string) => void;
};

export function ArtifactCategoryPicker({ open, onClose, onStarted }: Props) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[65] bg-black/55 backdrop-blur-[2px]"
        aria-label="Close category picker"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-category-title"
        className="fixed z-[66] inset-x-0 bottom-0 max-h-[min(92dvh,720px)] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[min(92vw,640px)] sm:max-h-[min(80vh,680px)] rounded-t-2xl sm:rounded-2xl border border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)] shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-[var(--dashboard-border)]">
          <div className="min-w-0">
            <h2 id="artifact-category-title" className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
              Let&apos;s get cooking
            </h2>
            <p className="text-sm text-muted mt-0.5">Pick a starting point — Agent Sam opens on this page.</p>
          </div>
          <button
            type="button"
            className="shrink-0 p-2 rounded-lg hover:bg-[var(--bg-hover)] text-muted"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            {ARTIFACT_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className="group text-left rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] p-4 min-h-[88px] transition-colors hover:border-[color-mix(in_srgb,var(--solar-cyan)_40%,var(--dashboard-border))] active:scale-[0.99] touch-manipulation"
                  onClick={() => {
                    startArtifactFromCategory(cat);
                    onStarted?.(cat.title);
                    onClose();
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--dashboard-border)]"
                      style={{ color: cat.accent }}
                    >
                      <Icon size={20} strokeWidth={1.5} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--solar-cyan)]">
                        {cat.title}
                      </span>
                      <span className="block text-xs text-muted mt-1 leading-snug">{cat.subtitle}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div
          className="shrink-0 px-4 sm:px-5 py-3 border-t border-[var(--dashboard-border)] text-[11px] text-muted text-center"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
        >
          Chat opens here — use the menu to return to your artifact list on phone.
        </div>
      </div>
    </>
  );
}
