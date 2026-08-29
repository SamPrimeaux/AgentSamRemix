/**
 * Images Lane 1 routes — App.tsx owns the live nested Route tree (lazy).
 * This module documents the same structure and can be used in tests.
 */

import React from 'react';
import { Navigate, Route } from 'react-router-dom';
import { ImagesShell } from './ImagesShell';
import { ImagesStoragePage } from './ImagesStoragePage';
import { ImagesDeliveryPage } from './ImagesDeliveryPage';
import { ImagesDeliveryVariantCreatePage } from './ImagesDeliveryVariantCreatePage';
import { ImagesKeysPage } from './ImagesKeysPage';
import { ImagesSourcingKitPage } from './ImagesSourcingKitPage';
import { ImagesDetailPage } from './ImagesDetailPage';
import { ImagesEditPage } from './ImagesEditPage';

/**
 * Route fragment for documentation / optional use.
 * Parent App.tsx should paste equivalent JSX with lazy components + authWorkspaceId.
 */
export function ImagesRoutes({ workspaceId }: { workspaceId?: string | null }) {
  return (
    <Route path="/dashboard/images" element={<ImagesShell workspaceId={workspaceId} />}>
      <Route index element={<Navigate to="storage" replace />} />
      <Route path="storage" element={<ImagesStoragePage />} />
      <Route path="delivery" element={<ImagesDeliveryPage />} />
      <Route path="delivery/variant/create" element={<ImagesDeliveryVariantCreatePage />} />
      <Route path="keys" element={<ImagesKeysPage />} />
      <Route path="sourcing-kit" element={<ImagesSourcingKitPage />} />
      {/* Videos live on sibling /dashboard/images/videos (VideosShell) — not nested here. */}
      <Route path=":id/edit" element={<ImagesEditPage />} />
      <Route path=":id" element={<ImagesDetailPage />} />
    </Route>
  );
}

/** Exact JSX string for Cursor parent to paste into App.tsx Routes. */
export const IMAGES_APP_ROUTE_JSX = `
<Route path="/dashboard/images" element={<ImagesShell workspaceId={authWorkspaceId || undefined} />}>
  <Route index element={<Navigate to="storage" replace />} />
  <Route path="storage" element={<ImagesStoragePage />} />
  <Route path="delivery" element={<ImagesDeliveryPage />} />
  <Route path="delivery/variant/create" element={<ImagesDeliveryVariantCreatePage />} />
  <Route path="keys" element={<ImagesKeysPage />} />
  <Route path="sourcing-kit" element={<ImagesSourcingKitPage />} />
  <Route path=":id/edit" element={<ImagesEditPage />} />
  <Route path=":id" element={<ImagesDetailPage />} />
</Route>
`.trim();

export default ImagesRoutes;
