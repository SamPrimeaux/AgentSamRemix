# CMS dashboard facade (`src/dashboard/cms/`)

**Canonical editor package:** `packages/client-cms-editor` (`@inneranimalmedia/client-cms-editor`).

This directory is a **thin monolith facade** — not a second editor implementation.

## What lives where

| Layer | Location | Role |
|-------|----------|------|
| **Editor UI** | `packages/client-cms-editor/frontend/` | `CmsEditor`, `mountClientCmsEditor`, `studio.css` |
| **Browser API + model** | `packages/client-cms-editor/backend/` | HTTP client, types, model mapping, preview bridge, routing re-exports |
| **Studio bundle entry** | `app/dashboard/studio-cms/main.tsx` + `vite.config.ts` | Builds isolated `dist/cms/studio-cms.js` (React inlined) |
| **CMS hub / iframe host** | `app/dashboard/pages/cms/*` | Discovery, routes, `StudioCmsHost` — not editor logic |
| **Worker CMS** | `src/core/agentsam/cms/` + `src/api/cms*.js` | D1, R2, publish, tools — server truth |
| **Monolith-only storefront** | `cmsStorefrontUrl.ts` | Hub URL helper with worker `resolveCmsStorefrontUrl` fallback |

## Imports

```tsx
// Editor (prefer package directly in new code)
import { mountClientCmsEditor } from '@inneranimalmedia/client-cms-editor/frontend';
import { getCmsEditorBootstrap } from '@inneranimalmedia/client-cms-editor/backend';

// Legacy / convenience re-exports
import { CmsEditor, getCmsEditorBootstrap } from '../../../src/dashboard/cms';

// Historical Studio alias names
import { getBootstrap, type StudioPage } from '../studio/iamApi';
```

## Build

`app/dashboard/package.json` runs two Vite builds:

1. Main dashboard PWA (`vite build`)
2. Studio CMS iframe bundle (`vite build --config studio-cms/vite.config.ts`)

Do not mount the editor from shared dashboard vendor chunks — the second build is intentional.

## Product laws

1. One editor implementation (`packages/client-cms-editor/frontend/CmsEditor.tsx`).
2. One browser API client (`packages/client-cms-editor/backend/src/api/client.ts`).
3. One Page → Section → Block model.
4. One preview/selection bridge.
5. No customer-specific seed content or fake success states.
6. Unsupported mutations must be visibly unavailable until a real CMS capability exists.
7. Iframe isolation is a **deployment** boundary, not a second architecture.
8. Reusable CMS business rules remain in `src/core/agentsam/cms/`; the editor calls HTTP contracts.

## Preview

The canvas defaults to the **live storefront draft** (`?preview=draft&cms=1`) when bootstrap provides a public domain. The local wireframe `srcDoc` remains a fallback when no domain is configured.

## Section artifact law (LOCKED)

Before public-read rewrites, see [`docs/platform/cms-section-artifact-law-2026-08.md`](../../../docs/platform/cms-section-artifact-law-2026-08.md):
D1 = pointers/indexes, R2 = section content, KV = hot published pointers.
