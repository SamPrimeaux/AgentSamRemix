/**
 * Design Mode context helpers (Browser → chat).
 * Not a composer mode — flag travels in browserContext.design_mode.
 */

export type DesignModeElement = {
  type: 'browser_element_selected';
  workspace_id?: string | null;
  url?: string;
  route_path?: string;
  selector?: string;
  xpath?: string | null;
  tag?: string;
  classes?: string[];
  text?: string;
  computed_styles?: Record<string, unknown>;
  section_key?: string | null;
  rect?: { top?: number; left?: number; width?: number; height?: number } | null;
  cms_mapping?: Record<string, unknown>;
  source_mapping?: Record<string, unknown>;
  [key: string]: unknown;
};

export type DesignModeAnnotation = {
  kind: 'strokes' | 'area';
  strokes?: Array<{ points: Array<{ x: number; y: number }>; color?: string }>;
  area?: { x: number; y: number; w: number; h: number };
  frame_data_url?: string | null;
};

export type DesignModeState = {
  active: boolean;
  selected_elements: DesignModeElement[];
  annotation?: DesignModeAnnotation | null;
};

export function emptyDesignModeState(): DesignModeState {
  return { active: false, selected_elements: [], annotation: null };
}

export function elementKey(el: DesignModeElement): string {
  return String(el.selector || el.xpath || `${el.tag}:${el.text?.slice(0, 40)}` || Math.random());
}

/** Merge pick into multi-select list (toggle if same selector). */
export function upsertDesignSelection(
  prev: DesignModeElement[],
  next: DesignModeElement,
  multi: boolean,
): DesignModeElement[] {
  const key = elementKey(next);
  if (!multi) return [next];
  const idx = prev.findIndex((e) => elementKey(e) === key);
  if (idx >= 0) {
    const copy = [...prev];
    copy.splice(idx, 1);
    return copy;
  }
  return [...prev, next].slice(0, 12);
}

export function buildDesignModeBrowserContextPatch(state: DesignModeState): {
  design_mode: DesignModeState;
  selected_element: DesignModeElement | null;
  selected_elements: DesignModeElement[];
  design_mode_active: boolean;
} {
  const primary = state.selected_elements[state.selected_elements.length - 1] || null;
  return {
    design_mode: {
      active: state.active,
      selected_elements: state.selected_elements,
      annotation: state.annotation || null,
    },
    selected_element: primary,
    selected_elements: state.selected_elements,
    design_mode_active: state.active,
  };
}
