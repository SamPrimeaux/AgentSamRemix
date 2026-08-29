/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser element + design-mode attach bridge. Mechanical peel from ChatAssistant.tsx.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction, type RefObject } from 'react';
import { browserElementMentionToken } from '../mentionContext';
import { COMPOSER_TEXTAREA_MAX_PX_NARROW, COMPOSER_TEXTAREA_MAX_PX_WIDE } from '../types';
import { syncComposerTextareaHeight } from '../composerLayout';

export type UseChatDesignModeBridgeArgs = {
  isNarrow: boolean;
  setBrowserElementContext: Dispatch<SetStateAction<Record<string, unknown> | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  pickedElementRef: MutableRefObject<Record<string, unknown> | null>;
  designModeContextRef: MutableRefObject<any>;
  setDesignModeActiveUi: Dispatch<SetStateAction<boolean>>;
  setDesignModeChips: Dispatch<SetStateAction<{ id: string; label: string }[]>>;
  fsChangeScopeRef: MutableRefObject<Record<string, unknown> | null>;
};

export function useChatDesignModeBridge(args: UseChatDesignModeBridgeArgs) {
  const {
    isNarrow, setBrowserElementContext, setInput, textareaRef, pickedElementRef,
    designModeContextRef, setDesignModeActiveUi, setDesignModeChips, fsChangeScopeRef,
  } = args;

  const clearBrowserElementContext = useCallback(() => {
    setBrowserElementContext(null);
    setInput((prev) => prev.replace(/@browser(?::[^\s@]+)?\s*/g, ' ').replace(/\s+/g, ' ').trim());
  }, []);

  const attachBrowserSelectionToComposer = useCallback((detail: Record<string, unknown>) => {
    const ctx = { ...detail, type: 'browser_element_selected' };
    setBrowserElementContext(ctx);
    const token = browserElementMentionToken(ctx);
    const insert = `@${token} `;
    setInput((prev) => {
      if (new RegExp(`@${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(prev)) return prev;
      const base = prev.replace(/@browser(?::[^\s@]+)?\s*/g, ' ').trim();
      return base ? `${base} ${insert}` : insert;
    });
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      syncComposerTextareaHeight(
        el,
        isNarrow ? COMPOSER_TEXTAREA_MAX_PX_NARROW : COMPOSER_TEXTAREA_MAX_PX_WIDE,
      );
    });
  }, [isNarrow]);

  const attachBrowserSelectionSilently = useCallback((detail: Record<string, unknown>) => {
    pickedElementRef.current = { ...detail, type: 'browser_element_selected' };
  }, []);

  /** Shared chip mapping for design-mode / context-attach selected_elements. */
  const designModeChipsFromElements = useCallback((els: Record<string, unknown>[]) => {
    setDesignModeChips(
      els.map((el, i) => ({
        id: String(el.selector || i),
        label: `${String(el.tag || 'el')}${el.selector ? ` · ${String(el.selector).slice(0, 28)}` : ''}`,
      })),
    );
  }, []);

  useEffect(() => {
    const onBrowserElementSelected = (ev: Event) => {
      const d = (ev as CustomEvent<Record<string, unknown>>).detail;
      if (!d || typeof d !== 'object') return;
      // Canonical BrowserView payload uses type=browser_element_selected; accept either.
      if (d.type != null && d.type !== 'browser_element_selected') return;
      attachBrowserSelectionSilently(d);
      const addToInput = d.add_to_input !== false;
      if (d.design_mode && addToInput) {
        attachBrowserSelectionToComposer(d);
      }
      if (Array.isArray(d.selected_elements)) {
        designModeChipsFromElements(d.selected_elements as Record<string, unknown>[]);
      }
    };
    const onContextAttach = (ev: Event) => {
      const d = (ev as CustomEvent<{
        browser_element?: Record<string, unknown>;
        design_mode?: boolean;
        selected_elements?: Record<string, unknown>[];
        fs_change_scope?: Record<string, unknown>;
      }>).detail;
      // FS change scope is the primary remaining use of this event (BrowserView no longer
      // double-fires browser_element here). Keep browser_element for any other emitters.
      if (d?.fs_change_scope && typeof d.fs_change_scope === 'object') {
        fsChangeScopeRef.current = d.fs_change_scope;
      }
      if (d?.browser_element && typeof d.browser_element === 'object') {
        pickedElementRef.current = d.browser_element;
      }
      if (Array.isArray(d?.selected_elements)) {
        designModeChipsFromElements(d.selected_elements);
      }
    };
    const onDesignMode = (ev: Event) => {
      const d = (ev as CustomEvent<{
        design_mode?: { active?: boolean; selected_elements?: Record<string, unknown>[]; annotation?: unknown };
        selected_elements?: Record<string, unknown>[];
        design_mode_active?: boolean;
        selected_element?: Record<string, unknown> | null;
      }>).detail;
      if (!d || typeof d !== 'object') return;
      const active = Boolean(d.design_mode_active ?? d.design_mode?.active);
      setDesignModeActiveUi(active);
      designModeContextRef.current = {
        design_mode: {
          active,
          selected_elements: Array.isArray(d.design_mode?.selected_elements)
            ? d.design_mode!.selected_elements!
            : Array.isArray(d.selected_elements)
              ? d.selected_elements
              : [],
          annotation: d.design_mode?.annotation ?? null,
        },
        selected_elements: Array.isArray(d.selected_elements)
          ? d.selected_elements
          : Array.isArray(d.design_mode?.selected_elements)
            ? d.design_mode!.selected_elements!
            : [],
        design_mode_active: active,
      };
      if (d.selected_element && typeof d.selected_element === 'object') {
        pickedElementRef.current = d.selected_element;
      }
      designModeChipsFromElements(designModeContextRef.current.selected_elements);
      if (!active) {
        setDesignModeChips([]);
      }
    };
    window.addEventListener('iam:browser-element-selected', onBrowserElementSelected as EventListener);
    window.addEventListener('iam:agent-context-attach', onContextAttach as EventListener);
    window.addEventListener('iam:design-mode-changed', onDesignMode as EventListener);
    return () => {
      window.removeEventListener('iam:browser-element-selected', onBrowserElementSelected as EventListener);
      window.removeEventListener('iam:agent-context-attach', onContextAttach as EventListener);
      window.removeEventListener('iam:design-mode-changed', onDesignMode as EventListener);
    };
  }, [attachBrowserSelectionSilently, attachBrowserSelectionToComposer, designModeChipsFromElements]);

  return { clearBrowserElementContext };
}
