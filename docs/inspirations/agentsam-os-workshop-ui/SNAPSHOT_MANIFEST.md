# Snapshot manifest

Exact source snapshot from `SamPrimeaux/agentsam-os@1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592`.

This directory is **reference-only**. It is intentionally not self-contained or buildable inside AgentSamRemix.
Missing imports are expected: the goal is to preserve the implementation of the visible workspace surfaces without
bringing the whole Cloudflare OS runtime, backend, Gatekeepers, router, or package graph into this repository.

## Core workspace files copied

- `source/GadgetEditor.tsx` — workspace shell, top chrome, resizable chat/work surface, output tabs, fullscreen.
- `source/ChatInterface.tsx` — transcript, work/tool rows, generated-output card, composer.
- `source/ChatInterface.module.css` — chat/composer presentation.
- `source/GadgetUI.tsx` — sandboxed generated-output view.
- `source/GadgetCodeInterface.tsx` — code peer-tab and diff surface.
- `source/Connections.tsx` — connections peer-tab.
- `source/WorkpiecePicker.tsx` — multi-output rail.
- `source/styles.css` — semantic theme/motion/surface language.
- `source/routes/workspace.$id.tsx` — route boundary.

## Small visual primitives copied

- `source/components/WorkshopControls.tsx`
- `source/components/SiteLogo.tsx`
- `source/components/UserMenu.tsx`
- `source/components/CountBadge.tsx`
- `source/components/GadgetPresence.tsx`
- `source/components/menuStyles.ts`
- `source/components/format/formats.ts`
- `source/components/format/FormatVisuals.tsx`
- `source/components/format/formatIconImage.ts`
- `source/components/format/messageFormatRefs.ts`
- `source/components/chat/ComposerMirror.tsx`
- `source/components/chat/ComposerMirror.module.css`

## Visual reference

- `reference/q3-planning-workspace.png`

## Explicitly not copied

- `packages/workshop-backend`
- `packages/workshop-shared`
- Gatekeepers / integrations
- Cloudflare OS auth, router, deployment, blueprints, backend/runtime packages
- the rest of `workshop-frontend`

When adopting a pattern, use `ADOPTION_MATRIX.md` to map it onto the existing AgentSamRemix owner instead of
copying its upstream dependency graph.
