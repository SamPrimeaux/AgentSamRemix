# @inneranimalmedia/client-cms-editor

Boring, generic, repurposable CMS editor package for Agent Sam client sites.

## Layout

```text
packages/client-cms-editor/
  backend/     API client, editor types, model mapping, routing, preview bridge
  frontend/    CmsEditor React UI + studio.css + mount helper
```

**Backend** has no React — safe to import from dashboard hub pages, tests, and thin hosts.

**Frontend** owns the Shopify-style editor chrome (rails, canvas, inspector). Mount via
`mountClientCmsEditor` or import `CmsEditor` directly.

## Install (monorepo)

```bash
# app/dashboard/package.json
"@inneranimalmedia/client-cms-editor": "file:../../packages/client-cms-editor"
```

## Usage

```tsx
import { CmsEditor } from '@inneranimalmedia/client-cms-editor';
import { getCmsEditorBootstrap, parseCmsRoute } from '@inneranimalmedia/client-cms-editor/backend';

// Isolated bundle entry (studio-cms.js)
import { mountClientCmsEditor } from '@inneranimalmedia/client-cms-editor/frontend';
mountClientCmsEditor(document.getElementById('app')!, {
  projectSlug: 'inneranimalmedia',
  panel: 'pages',
});
```

## Canonical home

- **Published SDK repo:** `github.com/SamPrimeaux/agentsam-sdk` → `packages/client-cms-editor/`
- **Platform mirror:** `inneranimalmedia/packages/client-cms-editor/`

Worker CMS domain logic stays in `src/core/agentsam/cms/`. This package is the **browser client**
only — HTTP to `/api/cms/*` on the host worker.

## Laws

1. One editor (`frontend/CmsEditor.tsx`).
2. One API client (`backend/api/client.ts`).
3. One preview bridge (`backend/preview/bridge.ts`).
4. Dashboard hub shells (`app/dashboard/pages/cms/`) are hosts, not second editors.
