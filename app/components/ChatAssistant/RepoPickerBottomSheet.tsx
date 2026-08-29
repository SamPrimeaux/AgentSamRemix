import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GithubContextLane } from './GithubContextLane';

const HEIGHT_KEY = 'iam-repo-drawer-height-vh';
const MIN_VH = 28;
const MAX_VH = 92;
const DEFAULT_VH = 58;

function readStoredHeightVh(): number {
  try {
    const n = Number(sessionStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(n) && n >= MIN_VH && n <= MAX_VH) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_VH;
}

type RepoPickerBottomSheetProps = {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null | undefined;
  githubRepoContext: string | null;
  githubFilePath?: string | null;
  onSelectRepo: (fullName: string) => void;
  onSelectFile?: (
    repo: string,
    path: string,
    branch: string,
    meta?: { content?: string | null; contentSha?: string | null; contentTruncated?: boolean },
  ) => void;
  onBrowseFiles?: (fullName: string) => void;
};

/** Desktop / legacy GitHub-only bottom sheet (mobile uses ContextHubDrawer). */
export function RepoPickerBottomSheet({
  open,
  onClose,
  workspaceId,
  githubRepoContext,
  onSelectRepo,
  onSelectFile,
  onBrowseFiles,
}: RepoPickerBottomSheetProps) {
  const [heightVh, setHeightVh] = useState(readStoredHeightVh);
  const heightVhRef = useRef(heightVh);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    heightVhRef.current = heightVh;
  }, [heightVh]);

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    resizeRef.current = { startY: e.clientY, startH: heightVh };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const dy = resizeRef.current.startY - e.clientY;
    const deltaVh = (dy / window.innerHeight) * 100;
    const next = Math.min(MAX_VH, Math.max(MIN_VH, resizeRef.current.startH + deltaVh));
    setHeightVh(next);
  };

  const onResizePointerUp = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.setItem(HEIGHT_KEY, String(Math.round(heightVhRef.current * 10) / 10));
    } catch {
      /* ignore */
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const sheet = (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[118] bg-black/45"
        aria-label="Close repository picker"
        onClick={onClose}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[119] flex flex-col rounded-t-2xl border-t border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] shadow-[0_-8px_32px_rgba(0,0,0,0.35)] touch-none"
        style={{
          height: `min(${heightVh}dvh, calc(100dvh - env(safe-area-inset-top, 0px) - 2rem))`,
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 2rem)',
          paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="GitHub repository and file picker"
      >
        <div
          className="flex shrink-0 flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none"
          role="separator"
          aria-label="Drag to resize repository drawer"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        >
          <div className="h-1.5 w-10 rounded-full bg-[var(--dashboard-border)]" aria-hidden />
        </div>
        <GithubContextLane
          workspaceId={workspaceId}
          githubRepoContext={githubRepoContext}
          onSelectRepo={onSelectRepo}
          onSelectFile={onSelectFile}
          onBrowseFiles={onBrowseFiles}
          onClose={onClose}
        />
      </div>
    </>
  );

  return createPortal(sheet, document.body);
}
