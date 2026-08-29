/** Folders at current prefix plus file rows (handles flat keys when API omits delimiter prefixes). */
export type R2ObjectRow = {
  key: string;
  size?: number;
  last_modified?: string | null;
};

export function partitionR2Listing(
  objects: R2ObjectRow[],
  apiPrefixes: string[],
  currentPrefix: string,
): { folders: string[]; files: R2ObjectRow[] } {
  const p = currentPrefix.replace(/\/$/, '');
  const pfx = p ? `${p}/` : '';
  const folderSet = new Set<string>();
  for (const pr of apiPrefixes) {
    if (typeof pr === 'string' && pr.startsWith(pfx)) folderSet.add(pr);
  }
  const files: R2ObjectRow[] = [];
  for (const obj of objects) {
    const k = obj.key;
    if (!k.startsWith(pfx)) continue;
    const rest = k.slice(pfx.length);
    const slash = rest.indexOf('/');
    if (slash < 0) {
      files.push(obj);
    } else {
      folderSet.add(pfx + rest.slice(0, slash + 1));
    }
  }
  const folders = [...folderSet].sort((a, b) => a.localeCompare(b));
  return { folders, files };
}

export function r2SavedBucketsStorageKey(userId: string | null | undefined): string {
  const uid = userId?.trim() || 'anonymous';
  return `iam_r2_saved_buckets_${uid}`;
}

export function loadR2SavedBuckets(userId: string | null | undefined): string[] {
  try {
    const raw = localStorage.getItem(r2SavedBucketsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  } catch {
    return [];
  }
}

export function saveR2SavedBuckets(userId: string | null | undefined, buckets: string[]): void {
  try {
    const uniq = [...new Set(buckets.map((b) => b.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
    localStorage.setItem(r2SavedBucketsStorageKey(userId), JSON.stringify(uniq));
  } catch {
    /* quota / private mode */
  }
}
