import type { CalendarInsightsPayload } from './ops-desk-types';

export function donutGradient(breakdown: Record<string, number>): string {
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const stops: string[] = [];
  const colors: Record<string, string> = {
    focus: '#1a73e8',
    task: '#34a853',
    tasks: '#34a853',
    one_on_one: '#fbbc04',
    multi_guest: '#ea4335',
    guests: '#ea4335',
  };
  for (const [key, mins] of Object.entries(breakdown)) {
    const pct = (mins / total) * 100;
    const color = colors[key] || '#9aa0a6';
    stops.push(`${color} ${acc}% ${acc + pct}%`);
    acc += pct;
  }
  if (!stops.length) return 'conic-gradient(#e8eaed 0% 100%)';
  return `conic-gradient(${stops.join(', ')})`;
}

export function weekLabelForAnchor(anchor: Date): string {
  const weekStart = new Date(anchor);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function remainingWorkMinutes(insights: CalendarInsightsPayload | null): number {
  const breakdown = insights?.insights.breakdown_minutes || {};
  const workMins = insights?.insights.working_minutes_per_day || 480;
  const scheduledMins = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return Math.max(0, workMins * 5 - scheduledMins);
}
