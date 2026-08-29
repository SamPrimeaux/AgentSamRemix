import { mapDriveFile, sortLibraryItems } from '../mappers';
import {
  fetchDriveListing,
  fetchGoogleIntegrationReady,
  searchDriveFiles,
} from '../libraryApi';
import type { LibraryListResult, LibraryProvider } from '../types';

export const driveProvider: LibraryProvider = {
  source: 'drive',
  label: 'Google Drive',
  async list(params) {
    const connected = await fetchGoogleIntegrationReady(params.signal);
    if (!connected) {
      return {
        items: [],
        driveConnected: false,
        error: 'Connect Google Drive to browse files',
      };
    }

    const driveView =
      params.rail === 'trash' ? 'trash' : params.rail === 'starred' ? 'starred' : params.driveView;

    const q = params.query?.trim();
    if (q && q.length >= 2 && params.rail !== 'trash' && params.rail !== 'starred') {
      const search = await searchDriveFiles(q, params.signal);
      if (!search.ok) return { items: [], driveConnected: true, error: search.error };
      return {
        items: sortLibraryItems(search.files.map((f) => mapDriveFile(f, driveView))),
        driveConnected: true,
      };
    }

    const listing = await fetchDriveListing({
      view: driveView,
      folderId: params.driveFolderId,
      sharedDriveId: params.sharedDriveId,
      signal: params.signal,
    });
    if (listing.unauthorized) {
      return {
        items: [],
        driveConnected: false,
        error: listing.error,
      };
    }
    if (!listing.ok) {
      return { items: [], driveConnected: true, error: listing.error };
    }
    return {
      items: sortLibraryItems(
        listing.files.map((f) => mapDriveFile(f, params.driveView, params.sharedDriveId)),
      ),
      driveConnected: true,
    };
  },
};
