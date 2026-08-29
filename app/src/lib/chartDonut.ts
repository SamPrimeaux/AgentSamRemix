/** Conic-gradient donut from labeled slices (Collaborate Time insights parity). */
export function conicDonutGradient(
  slices: { key: string; color: string; val: number }[],
): string {
  const total = slices.reduce((s, x) => s + x.val, 0) || 1;
  let acc = 0;
  const stops = slices.map((s) => {
    const pct = (s.val / total) * 100;
    const from = acc;
    acc += pct;
    return `${s.color} ${from}% ${acc}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export function calendarBreakdownGradient(breakdown: Record<string, number>): string {
  return conicDonutGradient([
    { key: 'focus', color: '#039be5', val: breakdown.focus || 0 },
    { key: 'task', color: '#4285f4', val: breakdown.task || 0 },
    { key: 'one_on_one', color: '#23a6d5', val: breakdown.one_on_one || 0 },
    { key: 'multi_guest', color: '#b2dfef', val: breakdown.multi_guest || 0 },
    { key: 'meeting', color: '#188038', val: breakdown.meeting || 0 },
  ]);
}

export function progressDonutGradient(open: number, done: number): string {
  return conicDonutGradient([
    { key: 'done', color: '#34a853', val: done },
    { key: 'open', color: '#4285f4', val: open },
  ]);
}

export function taskMinutesGradient(
  rows: { title: string; minutes: number }[],
): string {
  const palette = ['#4285f4', '#039be5', '#23a6d5', '#7baaf7', '#b2dfef', '#dadce0'];
  const top = rows.filter((r) => r.minutes > 0).slice(0, 5);
  const other = rows.slice(5).reduce((s, r) => s + r.minutes, 0);
  const slices = top.map((r, i) => ({
    key: r.title,
    color: palette[i % palette.length],
    val: r.minutes,
  }));
  if (other > 0) slices.push({ key: 'other', color: '#5f6368', val: other });
  if (!slices.length) slices.push({ key: 'empty', color: '#3c4043', val: 1 });
  return conicDonutGradient(slices);
}
