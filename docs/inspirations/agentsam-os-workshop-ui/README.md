# AgentSam OS Workshop UI inspiration

This directory is an intentionally isolated design/reference snapshot for the `agentsam-os-inspirations` branch.
It captures the parts of `SamPrimeaux/agentsam-os` that materially define the Q3 Planning Workspace UI without
turning AgentSamRemix into a fork of Cloudflare OS.

![Q3 Planning Workspace reference](./reference/q3-planning-workspace.png)

## Why this exists

AgentSamRemix already has the runtime capabilities we care about: Agent Sam chat/SSE, Monaco, terminal lanes,
browser/live computer surfaces, connectors, artifacts, modes, mobile/PWA behavior, and authenticated dashboard
routing. The useful thing in `agentsam-os` is the **presentation architecture**: a calm split workspace, compact
agent activity, generated-output cards, peer `Output / Code / Connections` views, restrained controls, and a
neutral visual system.

This branch gives us a place to study and port those ideas deliberately instead of replacing the current UI in one
unreviewable sweep.

## Hard guardrail

**Nothing under `docs/inspirations/agentsam-os-workshop-ui/` is a production import.**

Do not bulk-wire these files into `app/index.tsx`, `AppShellFrame`, Vite, or the Agent routes. Several upstream
files depend on Kumo, Phosphor, Cap'n Web, Yjs, `Overseer`, `GadgetClient`, and Cloudflare OS-specific contracts.
Those are not automatically architectural improvements for AgentSamRemix just because the UI is good.

The adoption loop is:

1. Pick one UX behavior or primitive.
2. Identify the existing AgentSamRemix owner component.
3. Port the behavior onto AgentSamRemix's existing runtime/data contracts.
4. Compare old/new on desktop and mobile.
5. Remove the superseded implementation only after the replacement works.

## Source baseline

- Upstream repo: `SamPrimeaux/agentsam-os`
- Upstream branch: `main`
- Upstream commit audited: `1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592`
- Screenshot: `docs/images/q3-planning-workspace.png`
- Frontend root: `packages/workshop-frontend/src/`
- License: Apache-2.0; preserved in `SOURCE_LICENSE.txt`.

## The UI composition we are preserving

```text
workspace shell
├── top workspace chrome
├── left agent conversation
│   ├── compact transcript
│   ├── expandable work/tool rows
│   ├── generated-output card
│   └── composer + resources/model
└── right work surface
    ├── dynamic Output tab (Slides / Document / App / ...)
    ├── Code
    └── Connections
```

The first right-hand tab is intentionally generic in the upstream implementation. Its internal key is `app`, while
its visible label comes from the selected output descriptor. A presentation therefore reads `Slides`; another
artifact can read `Document`, `App`, etc. That pattern is more useful to us than cloning separate product modes.

## What is copied here

The `source/` directory contains an exact, reference-only snapshot of the core upstream workspace files and the smaller presentation primitives that define the screenshot:

- `ChatInterface.module.css` — markdown, streaming/thinking, capsule/composer presentation.
- `GadgetUI.tsx` — generated-output iframe shell and loading/error/fullscreen-adjacent behavior.
- `Connections.tsx` — connections-as-peer-surface presentation.
- `WorkpiecePicker.tsx` — compact multi-output rail.
- `components/WorkshopControls.tsx` — restrained shared button/input primitives.
- `components/SiteLogo.tsx` and `components/UserMenu.tsx` — minimal top chrome pieces.
- `components/format/formats.ts` — output vocabulary.
- `components/format/FormatVisuals.tsx` — glyphs, miniatures, thumbnails, wireframes.
- `styles.css` — upstream semantic tokens, neutral surfaces, motion, shadows, and scrollbar treatment.
- `routes/workspace.$id.tsx` — route boundary for understanding the shell.

The three large controllers (`GadgetEditor.tsx`, `ChatInterface.tsx`, and `GadgetCodeInterface.tsx`) are included **only as inert reference source under `docs/`**. They are not dependency-complete and must not be wired into the app wholesale. `SOURCE_POINTERS.md` records their upstream SHAs and the specific behaviors worth adopting.

Read `ADOPTION_MATRIX.md` before moving anything into `app/`.
