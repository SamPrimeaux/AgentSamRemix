/**
 * Plan-mode template chips — house / site / floor / elevation skeletons for Draw from Design Studio.
 */
export type DrawPlanTemplate = {
  id: string;
  label: string;
  subtitle: string;
  /** Optional cover for template picker (Cloudflare Images or R2 URL). */
  coverUrl?: string;
};

export const DRAW_PLAN_TEMPLATES: DrawPlanTemplate[] = [
  {
    id: 'house_plan',
    label: 'House plan',
    subtitle: 'Rooms · massing · notes',
  },
  {
    id: 'site_plan',
    label: 'Site plan',
    subtitle: 'Setbacks · driveway · utilities',
  },
  {
    id: 'floor_plan',
    label: 'Floor plan',
    subtitle: 'Walls · doors · dimensions',
  },
  {
    id: 'elevation',
    label: 'Elevation',
    subtitle: 'Front / side study',
  },
];

export function isDrawPlanDeepLink(search: string): boolean {
  try {
    const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return q.get('from') === 'designstudio' && q.get('mode') === 'plan';
  } catch {
    return false;
  }
}

export function drawPlanTemplateEvent(templateId: string) {
  return new CustomEvent('iam:draw_plan_template', { detail: { templateId } });
}
