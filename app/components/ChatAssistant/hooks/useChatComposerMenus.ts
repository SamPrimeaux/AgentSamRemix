/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Attach / mode / model menu positioning + dismiss.
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo,
  type CSSProperties, type Dispatch, type RefObject, type SetStateAction,
} from 'react';
import { useClickOutsideToClose } from '../../../hooks/useClickOutsideToClose';
import { measureAboveAnchor, measureBelowComposerAnchor } from '../composerLayout';

export function useChatComposerMenus(args: {
  attachMenuOpen: boolean;
  setAttachMenuOpen: Dispatch<SetStateAction<boolean>>;
  setAttachMenuStyle: Dispatch<SetStateAction<CSSProperties | null>>;
  isModeOpen: boolean;
  setIsModeOpen: Dispatch<SetStateAction<boolean>>;
  setModeMenuStyle: Dispatch<SetStateAction<CSSProperties | null>>;
  isModelPickerOpen: boolean;
  setIsModelPickerOpen: Dispatch<SetStateAction<boolean>>;
  setModelPickerStyle: Dispatch<SetStateAction<CSSProperties | null>>;
  composerGlassRef: RefObject<HTMLDivElement | null>;
  modeButtonRef: RefObject<HTMLButtonElement | null>;
  modeMenuRef: RefObject<HTMLDivElement | null>;
  modelButtonRef: RefObject<HTMLButtonElement | null>;
  modelPickerRef: RefObject<HTMLDivElement | null>;
  attachButtonRef: RefObject<HTMLButtonElement | null>;
  attachMenuRef: RefObject<HTMLDivElement | null>;
}) {
  const {
    attachMenuOpen, setAttachMenuOpen, setAttachMenuStyle, isModeOpen, setIsModeOpen, setModeMenuStyle,
    isModelPickerOpen, setIsModelPickerOpen, setModelPickerStyle, composerGlassRef, modeButtonRef,
    modeMenuRef, modelButtonRef, modelPickerRef, attachButtonRef, attachMenuRef,
  } = args;
  const measureAttachMenu = useCallback(() => {
    setAttachMenuStyle(measureBelowComposerAnchor(composerGlassRef.current, 480));
  }, [composerGlassRef, setAttachMenuStyle]);

  const measureModeMenu = useCallback(() => {
    setModeMenuStyle(measureAboveAnchor(modeButtonRef.current, 200, 320));
  }, [modeButtonRef, setModeMenuStyle]);

  const measureModelPickerMenu = useCallback(() => {
    setModelPickerStyle(measureAboveAnchor(modelButtonRef.current, 280, 360, 320));
  }, [modelButtonRef, setModelPickerStyle]);

  const closeAttach = useCallback(() => setAttachMenuOpen(false), [setAttachMenuOpen]);
  const closeMode = useCallback(() => setIsModeOpen(false), [setIsModeOpen]);
  const closeModel = useCallback(() => setIsModelPickerOpen(false), [setIsModelPickerOpen]);
  const attachExcept = useMemo(() => [attachButtonRef], [attachButtonRef]);
  const modeExcept = useMemo(() => [modeButtonRef], [modeButtonRef]);
  const modelExcept = useMemo(() => [modelButtonRef], [modelButtonRef]);

  useClickOutsideToClose(attachMenuRef, attachMenuOpen, closeAttach, attachExcept);
  useClickOutsideToClose(modeMenuRef, isModeOpen, closeMode, modeExcept);
  useClickOutsideToClose(modelPickerRef, isModelPickerOpen, closeModel, modelExcept);

  useEffect(() => {
    if (!attachMenuOpen && !isModeOpen && !isModelPickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (attachMenuOpen) setAttachMenuOpen(false);
      if (isModeOpen) setIsModeOpen(false);
      if (isModelPickerOpen) setIsModelPickerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    attachMenuOpen,
    isModeOpen,
    isModelPickerOpen,
    setAttachMenuOpen,
    setIsModeOpen,
    setIsModelPickerOpen,
  ]);

  useLayoutEffect(() => {
    if (!attachMenuOpen) {
      setAttachMenuStyle(null);
      return;
    }
    measureAttachMenu();
    const h = () => measureAttachMenu();
    window.addEventListener('resize', h);
    window.addEventListener('scroll', h, true);
    return () => {
      window.removeEventListener('resize', h);
      window.removeEventListener('scroll', h, true);
    };
  }, [attachMenuOpen, measureAttachMenu, setAttachMenuStyle]);

  useLayoutEffect(() => {
    if (!isModeOpen) {
      setModeMenuStyle(null);
      return;
    }
    measureModeMenu();
    const h = () => measureModeMenu();
    window.addEventListener('resize', h);
    window.addEventListener('scroll', h, true);
    return () => {
      window.removeEventListener('resize', h);
      window.removeEventListener('scroll', h, true);
    };
  }, [isModeOpen, measureModeMenu, setModeMenuStyle]);

  useLayoutEffect(() => {
    if (!isModelPickerOpen) {
      setModelPickerStyle(null);
      return;
    }
    measureModelPickerMenu();
    const h = () => measureModelPickerMenu();
    window.addEventListener('resize', h);
    window.addEventListener('scroll', h, true);
    return () => {
      window.removeEventListener('resize', h);
      window.removeEventListener('scroll', h, true);
    };
  }, [isModelPickerOpen, measureModelPickerMenu, setModelPickerStyle]);
}
