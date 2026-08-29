/** US federal + common observances for calendar overlay (all-day). */

function nthWeekdayOfMonth(year, monthIndex, weekday, n) {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  let count = 0;
  while (d.getUTCMonth() === monthIndex) {
    if (d.getUTCDay() === weekday) {
      count += 1;
      if (count === n) return new Date(d);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return new Date(Date.UTC(year, monthIndex, 1));
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function holidayRow(id, title, date, color = '#188038') {
  const key = ymd(date);
  return {
    id: `hol_${id}_${key}`,
    title,
    event_type: 'holiday',
    calendar_source: 'holidays',
    all_day: 1,
    start_datetime: `${key} 00:00:00`,
    end_datetime: `${key} 23:59:59`,
    color,
    status: 'scheduled',
  };
}

/** @param {number} year */
export function usHolidayEventsForYear(year) {
  const out = [];
  out.push(holidayRow('ny', "New Year's Day", new Date(Date.UTC(year, 0, 1))));
  out.push(holidayRow('mlk', 'Martin Luther King Jr. Day', nthWeekdayOfMonth(year, 0, 1, 3)));
  out.push(holidayRow('pres', "Presidents' Day", nthWeekdayOfMonth(year, 1, 1, 3)));
  out.push(holidayRow('mem', 'Memorial Day', lastWeekdayOfMonth(year, 4, 1)));
  out.push(holidayRow('juneteenth', 'Juneteenth', new Date(Date.UTC(year, 5, 19))));
  out.push(holidayRow('jul4', 'Independence Day', new Date(Date.UTC(year, 6, 4))));
  out.push(holidayRow('labor', 'Labor Day', nthWeekdayOfMonth(year, 8, 1, 1)));
  out.push(holidayRow('indigenous', 'Indigenous Peoples\' Day', nthWeekdayOfMonth(year, 9, 1, 2)));
  out.push(holidayRow('veterans', 'Veterans Day', new Date(Date.UTC(year, 10, 11))));
  out.push(holidayRow('thanks', 'Thanksgiving', nthWeekdayOfMonth(year, 10, 4, 4)));
  out.push(holidayRow('xmas', 'Christmas Day', new Date(Date.UTC(year, 11, 25))));
  return out;
}

/** @param {string} fromSql @param {string} toSql */
export function usHolidaysInWindow(fromSql, toSql) {
  const from = new Date(String(fromSql).replace(' ', 'T') + 'Z');
  const to = new Date(String(toSql).replace(' ', 'T') + 'Z');
  const years = new Set([from.getUTCFullYear(), to.getUTCFullYear()]);
  const all = [];
  for (const y of years) all.push(...usHolidayEventsForYear(y));
  const fromMs = from.getTime();
  const toMs = to.getTime();
  return all.filter((h) => {
    const s = new Date(h.start_datetime.replace(' ', 'T') + 'Z').getTime();
    return s >= fromMs - 86400000 && s <= toMs + 86400000;
  });
}
