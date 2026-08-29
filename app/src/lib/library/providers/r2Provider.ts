import { mapR2FolderPrefix, mapR2Object, sortLibraryItems } from '../mappers';
import { fetchR2BucketNames, fetchR2Listing } from '../libraryApi';
import type { LibraryListResult, LibraryProvider } from '../types';

export const r2Provider: LibraryProvider = {
  source: 'r2',
  label: 'R2 Storage',
  async list(params) {
    let bucket = params.r2Bucket?.trim();
    if (!bucket) {
      const buckets = await fetchR2BucketNames(params.signal);
      bucket = buckets[0] || '';
    }
    if (!bucket) {
      return { items: [], error: 'No R2 buckets available for this workspace' };
    }

    const prefix = params.r2Prefix ?? '';
    const listing = await fetchR2Listing(bucket, prefix, params.signal);
    if (!listing.ok) {
      return { items: [], error: listing.error };
    }

    const folders = listing.folders.map((p) => mapR2FolderPrefix(bucket!, p));
    const files = listing.files.map((o) => mapR2Object(bucket!, o));
    return { items: sortLibraryItems([...folders, ...files]) };
  },
};
