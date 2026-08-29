/** @license SPDX-License-Identifier: Apache-2.0 */
import {
  useState, useEffect, useCallback, useRef,
  type Dispatch, type MutableRefObject, type SetStateAction,
} from 'react';
import {
  type DesignModeElement,
  type DesignModeState,
  upsertDesignSelection,
  buildDesignModeBrowserContextPatch,
} from './designModeContext.ts';
import { safeClassText, type PaneMode, type InspectedElement } from './types.ts';
import type { PickerHighlightRect } from './elementPickerScripts.ts';

export type UseDesignModeOptions = {
  currentUrlRef: MutableRefObject<string>;
  mode: PaneMode;
  setMode: Dispatch<SetStateAction<PaneMode>>;
  setInspectedEl: Dispatch<SetStateAction<InspectedElement | null>>;
  setInspectEpoch: Dispatch<SetStateAction<number>>;
  setDevToolsOpen: Dispatch<SetStateAction<boolean>>;
  setToastMsg: Dispatch<SetStateAction<string | null>>;
  teardownPickerScript: () => void;
  setPickerCrossOrigin: Dispatch<SetStateAction<boolean>>;
  setPickerHighlight: Dispatch<SetStateAction<PickerHighlightRect | null>>;
  screenshotUrl: string | null;
  runScreenshot: (clip?: { x: number; y: number; width: number; height: number }) => Promise<void>;
};

export function useDesignMode(opts: UseDesignModeOptions) {
  const {
    currentUrlRef,
    mode,
    setMode,
    setInspectedEl,
    setInspectEpoch,
    setDevToolsOpen,
    setToastMsg,
    teardownPickerScript,
    setPickerCrossOrigin,
    setPickerHighlight,
    screenshotUrl,
    runScreenshot,
  } = opts;

  const [designModeOn, setDesignModeOn] = useState(false);
  const [designSelections, setDesignSelections] = useState<DesignModeElement[]>([]);
  const [annotateStrokes, setAnnotateStrokes] = useState<
    Array<{ points: Array<{ x: number; y: number }>; color?: string }>
  >([]);
  const [annotateFrame, setAnnotateFrame] = useState<string | null>(null);

  const annotateDrawingRef = useRef(false);
  const annotateCurrentRef = useRef<Array<{ x: number; y: number }>>([]);
  const designModeOnRef = useRef(false);
  const designSelectionsRef = useRef<DesignModeElement[]>([]);

  useEffect(() => {
    designModeOnRef.current = designModeOn;
  }, [designModeOn]);
  useEffect(() => {
    designSelectionsRef.current = designSelections;
  }, [designSelections]);

  const publishDesignModeSurface = useCallback(
    (next: Partial<DesignModeState> & { active?: boolean }) => {
      const active = next.active ?? designModeOnRef.current;
      const selected =
        next.selected_elements !== undefined
          ? next.selected_elements
          : designSelectionsRef.current;
      const annotation =
        next.annotation !== undefined
          ? next.annotation
          : annotateStrokes.length
            ? {
                kind: 'strokes' as const,
                strokes: annotateStrokes,
                frame_data_url: annotateFrame,
              }
            : null;
      const state: DesignModeState = {
        active,
        selected_elements: selected,
        annotation,
      };
      const patch = buildDesignModeBrowserContextPatch(state);
      window.dispatchEvent(
        new CustomEvent('iam:design-mode-changed', { detail: patch }),
      );
      window.dispatchEvent(
        new CustomEvent('iam-browser-surface-context', {
          detail: {
            design_mode: patch.design_mode,
            design_mode_active: patch.design_mode_active,
            selected_element: patch.selected_element,
            selected_elements: patch.selected_elements,
            url: currentUrlRef.current,
          },
        }),
      );
    },
    [annotateStrokes, annotateFrame, currentUrlRef],
  );

  const applyElementSelection = useCallback((el: InspectedElement, opts?: { metaKey?: boolean; altKey?: boolean }) => {
    setInspectedEl(el);
    setInspectEpoch((n) => n + 1);
    const inDesign = designModeOnRef.current;
    if (inDesign) {
      setMode('picker');
      setPickerHighlight(null);
      setDevToolsOpen(true);
    } else {
      setMode('browse');
      setPickerCrossOrigin(false);
      setPickerHighlight(null);
      setDevToolsOpen(true);
    }
    window.dispatchEvent(new CustomEvent('iam-browser-set-inspector', { detail: el }));
    const urlNow = currentUrlRef.current;
    const wid =
      typeof window !== 'undefined'
        ? String((window as unknown as { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__ || '').trim()
        : '';
    const wsId = wid && wid !== 'global' ? wid : null;
    let routePath = '';
    try {
      routePath = new URL(urlNow).pathname;
    } catch {
      routePath = '';
    }
    const classes = safeClassText(el).split(/\s+/).filter(Boolean);
    let sectionKey: string | null = null;
    let n: HTMLElement | null = el as unknown as HTMLElement;
    for (let i = 0; i < 8 && n; i++) {
      sectionKey =
        n.getAttribute?.('data-section-key') ||
        n.getAttribute?.('data-section') ||
        n.getAttribute?.('data-iam-section') ||
        sectionKey;
      n = n.parentElement;
    }
    const htmlText =
      typeof el.html === 'string' ? el.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    const st = el.styles || {};
    const bbox = el.boundingBox ?? null;
    const payload: DesignModeElement = {
      type: 'browser_element_selected',
      workspace_id: wsId,
      url: urlNow,
      route_path: routePath,
      selector: el.path || '',
      xpath: typeof (el as { xpath?: string }).xpath === 'string' ? (el as { xpath?: string }).xpath : null,
      tag: el.tag,
      id: el.id ?? null,
      className: el.className ?? null,
      classes,
      text: htmlText,
      computed_styles: {
        color: st.color,
        font_size: st['font-size'] ?? st.fontSize,
        font_family: st['font-family'] ?? st.fontFamily,
        font_weight: st['font-weight'] ?? st.fontWeight,
        background: st.background ?? st.backgroundColor,
        width: st.width,
        height: st.height,
      },
      rect: bbox
        ? {
            top: Number((bbox as { y?: number; top?: number }).y ?? (bbox as { top?: number }).top ?? 0),
            left: Number((bbox as { x?: number; left?: number }).x ?? (bbox as { left?: number }).left ?? 0),
            width: Number((bbox as { width?: number }).width ?? 0),
            height: Number((bbox as { height?: number }).height ?? 0),
          }
        : null,
      section_key: sectionKey,
      cms_mapping: {
        page_id: null as string | null,
        section_id: null as string | null,
        section_key: sectionKey,
        component_id: null as string | null,
        asset_id: null as string | null,
      },
      source_mapping: {
        provider: 'unknown',
        path: '',
        r2_key: '',
        repo: '',
        branch: '',
      },
    };

    if (inDesign) {
      const multi = true;
      const next = upsertDesignSelection(designSelectionsRef.current, payload, multi);
      setDesignSelections(next);
      designSelectionsRef.current = next;
      publishDesignModeSurface({ active: true, selected_elements: next });
      const addToInput = !opts?.altKey;
      window.dispatchEvent(
        new CustomEvent('iam:browser-element-selected', {
          detail: { ...payload, design_mode: true, add_to_input: addToInput, selected_elements: next },
        }),
      );
      return;
    }

    window.dispatchEvent(new CustomEvent('iam:browser-element-selected', { detail: payload }));
  }, [
    currentUrlRef,
    publishDesignModeSurface,
    setDevToolsOpen,
    setInspectEpoch,
    setInspectedEl,
    setMode,
    setPickerCrossOrigin,
    setPickerHighlight,
  ]);

  const setDesignMode = useCallback(
    (on: boolean) => {
      setDesignModeOn(on);
      designModeOnRef.current = on;
      if (on) {
        setMode('browse');
        void teardownPickerScript();
        publishDesignModeSurface({ active: true });
        setToastMsg('Design Mode armed — Agent kit auto. Use picker to inspect; Esc to browse.');
      } else {
        setMode('browse');
        setDesignSelections([]);
        designSelectionsRef.current = [];
        setAnnotateStrokes([]);
        setAnnotateFrame(null);
        void teardownPickerScript();
        publishDesignModeSurface({
          active: false,
          selected_elements: [],
          annotation: null,
        });
        setToastMsg('Design Mode off');
      }
      window.setTimeout(() => setToastMsg(null), 3200);
    },
    [publishDesignModeSurface, setMode, setToastMsg, teardownPickerScript],
  );

  const toggleDesignMode = useCallback(() => {
    setDesignMode(!designModeOnRef.current);
  }, [setDesignMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && String(e.key).toLowerCase() === 'd') {
        e.preventDefault();
        toggleDesignMode();
        return;
      }
      if (e.key === 'Escape' && (mode === 'picker' || mode === 'annotate' || mode === 'area')) {
        e.preventDefault();
        setMode('browse');
        void teardownPickerScript();
        setPickerCrossOrigin(false);
        setPickerHighlight(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDesignMode, mode, teardownPickerScript, setMode, setPickerCrossOrigin, setPickerHighlight]);

  const startAnnotateMode = useCallback(async () => {
    if (!designModeOnRef.current) setDesignMode(true);
    setMode('annotate');
    if (screenshotUrl) {
      setAnnotateFrame(screenshotUrl);
    } else {
      await runScreenshot();
      setAnnotateFrame((prev) => prev || screenshotUrl);
    }
    setAnnotateStrokes([]);
  }, [setDesignMode, screenshotUrl, runScreenshot, setMode]);

  useEffect(() => {
    if (mode === 'annotate' && screenshotUrl) {
      setAnnotateFrame((prev) => prev || screenshotUrl);
    }
  }, [mode, screenshotUrl]);

  return {
    designModeOn,
    designSelections,
    annotateStrokes,
    setAnnotateStrokes,
    annotateFrame,
    setAnnotateFrame,
    annotateDrawingRef,
    annotateCurrentRef,
    publishDesignModeSurface,
    applyElementSelection,
    setDesignMode,
    toggleDesignMode,
    startAnnotateMode,
  };
}
