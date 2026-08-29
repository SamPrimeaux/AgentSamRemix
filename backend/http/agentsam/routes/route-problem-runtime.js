export function routeFilterErrorLogForProblemsSurface(rows) {
  return Array.isArray(rows)
    ? rows.filter((row) => String(row?.error_type || '').trim() !== 'db_write_failure')
    : [];
}
