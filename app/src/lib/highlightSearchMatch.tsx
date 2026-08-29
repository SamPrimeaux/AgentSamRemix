import React from 'react';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive substring highlight for sidebar table search (D1 Studio style).
 */
export function highlightSearchMatch(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;

  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const idx = lowerText.indexOf(lowerQ);
  if (idx < 0) return text;

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);

  return (
    <>
      {before}
      <mark className="database-search-mark">{match}</mark>
      {after}
    </>
  );
}

/** Split all match segments for long names with multiple occurrences. */
export function highlightSearchMatchAll(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;

  const re = new RegExp(`(${escapeRegExp(q)})`, 'gi');
  const parts = text.split(re);
  if (parts.length <= 1) return text;

  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={`${part}-${i}`} className="database-search-mark">
        {part}
      </mark>
    ) : (
      <React.Fragment key={`t-${i}`}>{part}</React.Fragment>
    ),
  );
}
