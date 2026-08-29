import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveFile } from '../types';
import { pickR2DisplayBuckets, type R2BucketsApiResponse } from '../src/lib/r2Buckets';
import {
  loadR2SavedBuckets,
  partitionR2Listing,
  saveR2SavedBuckets,
  type R2ObjectRow,
} from '../src/lib/r2Listing';
import { IAM_PALETTE_OPEN_R2 } from '../src/lib/agentSamFilesystemTypes';

export type R2FilesController = {
  displayR2Buckets: string[];
  selectedR2Bucket: string;
  setSelectedR2Bucket: React.Dispatch<React.SetStateAction<string>>;
  setR2PrefixByBucket: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setR2SearchMode: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  r2PrefixByBucket: Record<string, string>;
  r2PrefixesByBucket: Record<string, string[]>;
  r2ObjectsByBucket: Record<string, R2ObjectRow[]>;
  r2ListCursorByBucket: Record<string, string | null>;
  r2ListTruncatedByBucket: Record<string, boolean>;
  r2Loading: boolean;
  r2Err: string | null;
  r2SearchQ: Record<string, string>;
  r2SearchMode: Record<string, boolean>;
  setR2SearchQ: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setR2Prefix: (bucket: string, prefix: string) => void;
  parentR2Prefix: (prefix: string) => string;
  loadR2List: (bucket: string) => Promise<void>;
  loadMoreR2List: (bucket: string) => void;
  runR2Search: (bucket: string) => Promise<void>;
  clearR2Search: (bucket: string) => void;
  openR2Key: (bucket: string, key: string) => Promise<void>;
  deleteR2Key: (bucket: string, key: string) => Promise<void>;
  createR2Folder: (bucket: string) => Promise<void>;
  uploadToR2: (bucket: string, files: FileList | null) => Promise<void>;
  r2AddOpen: boolean;
  setR2AddOpen: React.Dispatch<React.SetStateAction<boolean>>;
  r2AddMode: 'connect' | 'create' | null;
  setR2AddMode: React.Dispatch<React.SetStateAction<'connect' | 'create' | null>>;
  r2AddName: string;
  setR2AddName: React.Dispatch<React.SetStateAction<string>>;
  r2AddBusy: boolean;
  connectR2Bucket: () => Promise<void>;
  createR2Bucket: () => Promise<void>;
  r2UploadRef: React.RefObject<HTMLInputElement>;
  setR2UploadTargetBucket: React.Dispatch<React.SetStateAction<string | null>>;
};

function parentR2Prefix(prefix: string): string {
  if (!prefix) return '';
  const trimmed = prefix.replace(/\/+$/, '');
  if (!trimmed) return '';
  const i = trimmed.lastIndexOf('/');
  return i < 0 ? '' : trimmed.slice(0, i + 1);
}

export function useR2FilesPane({
  userId,
  activeSource,
  onOpenInEditor,
}: {
  userId?: string | null;
  activeSource: string;
  onOpenInEditor?: (file: ActiveFile) => void;
}): R2FilesController {
    const [r2Buckets, setR2Buckets] = useState<string[]>([]);
    const [r2SavedBuckets, setR2SavedBuckets] = useState<string[]>(() => loadR2SavedBuckets(userId));
    const [selectedR2Bucket, setSelectedR2Bucket] = useState<string>('');
    const [r2AddOpen, setR2AddOpen] = useState(false);
    const [r2AddMode, setR2AddMode] = useState<'connect' | 'create' | null>(null);
    const [r2AddName, setR2AddName] = useState('');
    const [r2AddBusy, setR2AddBusy] = useState(false);
    const [r2PrefixByBucket, setR2PrefixByBucket] = useState<Record<string, string>>({});
    const [r2PrefixesByBucket, setR2PrefixesByBucket] = useState<Record<string, string[]>>({});
    const [r2ObjectsByBucket, setR2ObjectsByBucket] = useState<Record<string, { key: string; size?: number }[]>>({});
    const [r2ListCursorByBucket, setR2ListCursorByBucket] = useState<Record<string, string | null>>({});
    const [r2ListTruncatedByBucket, setR2ListTruncatedByBucket] = useState<Record<string, boolean>>({});
    const [r2Loading, setR2Loading] = useState(false);
    const [r2Err, setR2Err] = useState<string | null>(null);
    const [r2SearchQ, setR2SearchQ] = useState<Record<string, string>>({});
    const [r2SearchMode, setR2SearchMode] = useState<Record<string, boolean>>({});
    const r2UploadRef = useRef<HTMLInputElement>(null);
    const [r2UploadTargetBucket, setR2UploadTargetBucket] = useState<string | null>(null);
    const [isSuperadmin, setIsSuperadmin] = useState(false);

    useEffect(() => {
      let cancelled = false;
      void fetch('/api/integrations/summary', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { capabilities?: { is_superadmin?: boolean } } | null) => {
          if (!cancelled) setIsSuperadmin(d?.capabilities?.is_superadmin === true);
        })
        .catch(() => {
          if (!cancelled) setIsSuperadmin(false);
        });
      return () => { cancelled = true; };
    }, []);
    const loadR2Buckets = useCallback(async () => {
        try {
            const qs = isSuperadmin ? '?all=true' : '';
            const res = await fetch(`/api/r2/buckets${qs}`, { credentials: 'same-origin' });
            const data = (await res.json()) as R2BucketsApiResponse;
            setR2Buckets(pickR2DisplayBuckets(data));
        } catch {
            setR2Buckets([]);
        }
    }, [isSuperadmin]);

    const displayR2Buckets = useMemo(() => {
        const merged: string[] = [];
        const seen = new Set<string>();
        for (const name of [...r2Buckets, ...r2SavedBuckets]) {
            const n = name.trim();
            if (!n || seen.has(n)) continue;
            seen.add(n);
            merged.push(n);
        }
        return merged.sort((a, b) => a.localeCompare(b));
    }, [r2Buckets, r2SavedBuckets]);

    const persistSavedR2Buckets = useCallback(
        (next: string[]) => {
            setR2SavedBuckets(next);
            saveR2SavedBuckets(userId, next);
        },
        [userId],
    );

    useEffect(() => {
        setR2SavedBuckets(loadR2SavedBuckets(userId));
    }, [userId]);

    useEffect(() => {
        loadR2Buckets();
    }, [loadR2Buckets]);

    useEffect(() => {
        if (displayR2Buckets.length === 0) {
            setSelectedR2Bucket('');
            return;
        }
        setSelectedR2Bucket((prev) => (prev && displayR2Buckets.includes(prev) ? prev : displayR2Buckets[0]));
    }, [displayR2Buckets]);

    const loadR2List = useCallback(async (
        bucket: string,
        prefixOverride?: string,
        opts?: { append?: boolean; cursor?: string },
    ) => {
        const append = opts?.append === true;
        if (!append) {
            setR2Loading(true);
        }
        setR2Err(null);
        const prefix = prefixOverride !== undefined ? prefixOverride : (r2PrefixByBucket[bucket] ?? '');
        try {
            const qs = new URLSearchParams({ bucket, prefix });
            if (opts?.cursor) qs.set('cursor', opts.cursor);
            const res = await fetch(`/api/r2/list?${qs}`, { credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok) {
                setR2Err(typeof data.error === 'string' ? data.error : `R2 list failed (${res.status})`);
                if (!append) {
                    setR2ObjectsByBucket((prev) => ({ ...prev, [bucket]: [] }));
                    setR2PrefixesByBucket((prev) => ({ ...prev, [bucket]: [] }));
                    setR2ListCursorByBucket((prev) => ({ ...prev, [bucket]: null }));
                    setR2ListTruncatedByBucket((prev) => ({ ...prev, [bucket]: false }));
                }
                return;
            }
            const rows = (Array.isArray(data.objects) ? data.objects : []) as R2ObjectRow[];
            const prefs = Array.isArray(data.prefixes) ? data.prefixes : [];
            const { folders, files } = partitionR2Listing(rows, prefs, prefix);
            if (append) {
                setR2ObjectsByBucket((prev) => {
                    const existing = prev[bucket] || [];
                    const seen = new Set(existing.map((o) => o.key));
                    const merged = [...existing];
                    for (const f of files) {
                        if (!seen.has(f.key)) merged.push(f);
                    }
                    return { ...prev, [bucket]: merged };
                });
            } else {
                setR2ObjectsByBucket((prev) => ({ ...prev, [bucket]: files }));
                setR2PrefixesByBucket((prev) => ({ ...prev, [bucket]: folders }));
            }
            const nextCursor =
                typeof data.cursor === 'string' && data.cursor.trim() ? data.cursor.trim() : null;
            setR2ListCursorByBucket((prev) => ({ ...prev, [bucket]: nextCursor }));
            setR2ListTruncatedByBucket((prev) => ({
                ...prev,
                [bucket]: !!(data.truncated && nextCursor),
            }));
        } catch (e) {
            console.error('[FilesRail] R2 list fetch failed:', e);
            setR2Err(e instanceof Error ? e.message : 'R2 list failed');
            if (!append) {
                setR2ObjectsByBucket((prev) => ({ ...prev, [bucket]: [] }));
                setR2PrefixesByBucket((prev) => ({ ...prev, [bucket]: [] }));
                setR2ListCursorByBucket((prev) => ({ ...prev, [bucket]: null }));
                setR2ListTruncatedByBucket((prev) => ({ ...prev, [bucket]: false }));
            }
        } finally {
            if (!append) setR2Loading(false);
        }
    }, [r2PrefixByBucket]);

    const loadMoreR2List = useCallback((bucket: string) => {
        const cursor = r2ListCursorByBucket[bucket];
        if (!cursor || r2Loading) return;
        void loadR2List(bucket, undefined, { append: true, cursor });
    }, [loadR2List, r2ListCursorByBucket, r2Loading]);

    useEffect(() => {
        if (activeSource !== 'r2' || !selectedR2Bucket) return;
        void loadR2List(selectedR2Bucket);
    }, [activeSource, selectedR2Bucket, loadR2List]);

    useEffect(() => {
        const onPaletteOpen = (e: Event) => {
            const b = (e as CustomEvent<{ bucket?: string }>).detail?.bucket?.trim();
            if (b) {
                persistSavedR2Buckets(
                    r2SavedBuckets.includes(b) ? r2SavedBuckets : [...r2SavedBuckets, b],
                );
                setSelectedR2Bucket(b);
            }
        };
        window.addEventListener(IAM_PALETTE_OPEN_R2, onPaletteOpen as EventListener);
        return () => window.removeEventListener(IAM_PALETTE_OPEN_R2, onPaletteOpen as EventListener);
    }, [persistSavedR2Buckets, r2SavedBuckets]);

    const validateR2BucketExists = async (name: string): Promise<boolean> => {
        const qs = new URLSearchParams({ bucket: name, prefix: '' });
        const res = await fetch(`/api/r2/list?${qs}`, { credentials: 'same-origin' });
        if (!res.ok) return false;
        const data = await res.json().catch(() => ({}));
        return !data.error;
    };

    const connectR2Bucket = async () => {
        const name = r2AddName.trim();
        if (!name) {
            setR2Err('Enter a bucket name.');
            return;
        }
        setR2AddBusy(true);
        setR2Err(null);
        try {
            const ok = await validateR2BucketExists(name);
            if (!ok) {
                setR2Err(`Bucket "${name}" not found or not accessible.`);
                return;
            }
            const next = r2SavedBuckets.includes(name) ? r2SavedBuckets : [...r2SavedBuckets, name];
            persistSavedR2Buckets(next);
            setSelectedR2Bucket(name);
            setR2AddOpen(false);
            setR2AddMode(null);
            setR2AddName('');
        } catch (e) {
            setR2Err(e instanceof Error ? e.message : 'Bucket validation failed');
        } finally {
            setR2AddBusy(false);
        }
    };

    const createR2Bucket = async () => {
        const name = r2AddName.trim().toLowerCase();
        if (!name) {
            setR2Err('Enter a bucket name.');
            return;
        }
        if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) {
            setR2Err('Name must be 3–63 chars: lowercase letters, numbers, hyphens.');
            return;
        }
        setR2AddBusy(true);
        setR2Err(null);
        try {
            const res = await fetch('/api/r2/buckets', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setR2Err(typeof data.error === 'string' ? data.error : `Create failed (${res.status})`);
                return;
            }
            const next = r2SavedBuckets.includes(name) ? r2SavedBuckets : [...r2SavedBuckets, name];
            persistSavedR2Buckets(next);
            setSelectedR2Bucket(name);
            setR2AddOpen(false);
            setR2AddMode(null);
            setR2AddName('');
            void loadR2Buckets();
        } catch (e) {
            setR2Err(e instanceof Error ? e.message : 'Create bucket failed');
        } finally {
            setR2AddBusy(false);
        }
    };

    const setR2Prefix = (bucket: string, prefix: string) => {
        setR2PrefixByBucket((prev) => ({ ...prev, [bucket]: prefix }));
        setR2SearchMode((m) => ({ ...m, [bucket]: false }));
        void loadR2List(bucket, prefix);
    };

    const runR2Search = async (bucket: string) => {
        const q = (r2SearchQ[bucket] || '').trim().toLowerCase();
        if (q.length < 2) {
            setR2Err('R2 search: at least 2 characters.');
            return;
        }
        setR2Loading(true);
        setR2Err(null);
        try {
            const prefix = r2PrefixByBucket[bucket] ?? '';
            const qs = new URLSearchParams({ bucket, q, prefix });
            const res = await fetch(`/api/r2/search?${qs}`, { credentials: 'same-origin' });
            const data = await res.json();
            const rows = Array.isArray(data.objects) ? data.objects : [];
            setR2SearchMode((m) => ({ ...m, [bucket]: true }));
            setR2ObjectsByBucket((prev) => ({ ...prev, [bucket]: rows }));
            setR2PrefixesByBucket((prev) => ({ ...prev, [bucket]: [] }));
        } catch (e) {
            setR2Err(e instanceof Error ? e.message : 'R2 search failed');
        } finally {
            setR2Loading(false);
        }
    };

    const clearR2Search = (bucket: string) => {
        setR2SearchQ((prev) => ({ ...prev, [bucket]: '' }));
        setR2SearchMode((m) => ({ ...m, [bucket]: false }));
        void loadR2List(bucket);
    };

    const uploadToR2 = async (bucket: string, files: FileList | null) => {
        if (!files?.length) return;
        const prefix = r2PrefixByBucket[bucket] ?? '';
        setR2Loading(true);
        setR2Err(null);
        try {
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const fd = new FormData();
                fd.append('bucket', bucket);
                fd.append('key', `${prefix}${f.name}`);
                fd.append('file', f);
                const res = await fetch('/api/r2/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setR2Err(typeof data.error === 'string' ? data.error : `Upload failed: ${f.name}`);
                    break;
                }
            }
        } catch (e) {
            setR2Err(e instanceof Error ? e.message : 'Upload failed');
        } finally {
            setR2Loading(false);
            if (r2UploadRef.current) r2UploadRef.current.value = '';
            setR2UploadTargetBucket(null);
            void loadR2List(bucket);
        }
    };

    const createR2Folder = async (bucket: string) => {
        const name = window.prompt('Folder name (prefix segment, no slashes)');
        if (!name || !name.trim()) return;
        const seg = name.trim().replace(/\/+/g, '').replace(/^\./, '');
        if (!seg) return;
        const prefix = r2PrefixByBucket[bucket] ?? '';
        const key = `${prefix}${seg}/`;
        setR2Loading(true);
        setR2Err(null);
        try {
            const res = await fetch('/api/r2/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ bucket, key, content: '' }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setR2Err(typeof data.error === 'string' ? data.error : 'Create folder marker failed');
                return;
            }
            void loadR2List(bucket);
        } catch (e) {
            setR2Err(e instanceof Error ? e.message : 'Create folder failed');
        } finally {
            setR2Loading(false);
        }
    };

    const deleteR2Key = async (bucket: string, key: string) => {
        if (!window.confirm(`Delete R2 object?\n${key}`)) return;
        setR2Loading(true);
        setR2Err(null);
        try {
            const res = await fetch('/api/r2/delete', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ bucket, key }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setR2Err(typeof data.error === 'string' ? data.error : 'Delete failed');
                return;
            }
            void loadR2List(bucket);
        } catch (e) {
            setR2Err(e instanceof Error ? e.message : 'Delete failed');
        } finally {
            setR2Loading(false);
        }
    };

    const openR2Key = async (bucket: string, key: string) => {
        if (!onOpenInEditor) return;
        setR2Loading(true);
        try {
            const { openR2KeyInEditor } = await import('../src/lib/mediaPreview');
            await openR2KeyInEditor(bucket, key, onOpenInEditor);
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return;
            console.error(e);
        } finally {
            setR2Loading(false);
        }
    };

    return {
      displayR2Buckets,
      selectedR2Bucket,
      setSelectedR2Bucket,
      setR2PrefixByBucket,
      setR2SearchMode,
      r2PrefixByBucket,
      r2PrefixesByBucket,
      r2ObjectsByBucket,
      r2ListCursorByBucket,
      r2ListTruncatedByBucket,
      r2Loading,
      r2Err,
      r2SearchQ,
      r2SearchMode,
      setR2SearchQ,
      setR2Prefix,
      parentR2Prefix,
      loadR2List: (bucket) => loadR2List(bucket),
      loadMoreR2List,
      runR2Search,
      clearR2Search,
      openR2Key,
      deleteR2Key,
      createR2Folder,
      uploadToR2,
      r2AddOpen,
      setR2AddOpen,
      r2AddMode,
      setR2AddMode,
      r2AddName,
      setR2AddName,
      r2AddBusy,
      connectR2Bucket,
      createR2Bucket,
      r2UploadRef,
      setR2UploadTargetBucket,
    };
}
