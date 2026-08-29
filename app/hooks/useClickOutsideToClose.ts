/**
 * Close a popup when mousedown lands outside its root (and optional except nodes).
 * Same pattern as the shell topbar "more" menu — one reusable listener.
 */
import { useEffect, type RefObject } from 'react';

export function useClickOutsideToClose(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
  exceptRefs?: ReadonlyArray<RefObject<HTMLElement | null>>,
): void {
  useEffect(() => {
    if (!isOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      if (exceptRefs?.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [ref, isOpen, onClose, exceptRefs]);
}
