export function selectionIsInsidePane(
  sel: Selection | null,
  root: Node | null,
): boolean;

export function pointerHitHelperTextarea(
  target: EventTarget | null | undefined,
  helper: Node | null | undefined,
): boolean;

export const IOS_TERMINAL_LONG_PRESS_MS: 420;

export function helperStyleUnderClientPoint(
  host: ParentNode & { getBoundingClientRect?: () => DOMRect },
  at: { clientX: number; clientY: number },
): { left: string; top: string };
