# Upstream source pointers

Audited against `SamPrimeaux/agentsam-os@1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592`.

## Large controllers captured as inert reference source

### Workspace shell

`packages/workshop-frontend/src/GadgetEditor.tsx`

- blob SHA: `70915c88f91f61c38065966e322b23455e2f7c16`
- owns the split workspace, chat-width persistence, pane transitions, top chrome, workpiece tabs, Output/Code/Connections tabs, and fullscreen output behavior.
- key design idea: `RightTab` stays generic (`app | code | connections`) and the visible `app` label is derived from the selected output format.

### Agent conversation

`packages/workshop-frontend/src/ChatInterface.tsx`

- blob SHA: `d5dac25aef8fa213ad121b91deb29c6098ff3b13`
- owns the quiet transcript presentation, generated-output card, grouped tool/work rows, streaming states, composer, resources, and model selection.
- useful design idea: tool activity is summarized into compact rows and details expand only when needed.
- useful design idea: `CreatedGadgetChatCard` makes generated work a first-class object in the transcript instead of dumping raw links/files.

### Code surface

`packages/workshop-frontend/src/GadgetCodeInterface.tsx`

- blob SHA: `d357705ac42cdfb10c0ddcafb97ccd4997e62a2f`
- owns the Code peer-tab presentation plus live/diff branch state.
- AgentSamRemix should borrow the peer-tab relationship and review UX, not the Yjs/Overseer implementation.

## Copied presentation-heavy files

| Upstream path | Blob SHA |
| --- | --- |
| `packages/workshop-frontend/src/ChatInterface.module.css` | `d6c87c1141a35c38447e6d1d7f96f152263959f0` |
| `packages/workshop-frontend/src/GadgetUI.tsx` | `8bc6bdfadbd0efdc4ba7ce370df3a64c648f408f` |
| `packages/workshop-frontend/src/Connections.tsx` | `1a6870670af21ec150f512f734c3a06685cf4c90` |
| `packages/workshop-frontend/src/WorkpiecePicker.tsx` | `34601f1c7999a4820bbfbe1c4e8ff00ab22cdfe8` |
| `packages/workshop-frontend/src/components/WorkshopControls.tsx` | `06ad7c1ce03964fed682ed9cf611ada819853d4a` |
| `packages/workshop-frontend/src/components/SiteLogo.tsx` | `1b673972b80f566c57fbebd5658841e3884114db` |
| `packages/workshop-frontend/src/components/UserMenu.tsx` | `860940b09e99f80dbfed16a7a1aa79fd8e90f22f` |
| `packages/workshop-frontend/src/components/format/formats.ts` | `3d7598400cc4af2a4322370b589008685c90b5ef` |
| `packages/workshop-frontend/src/components/format/FormatVisuals.tsx` | `37607fa9c18708d1e2ba703e1ee99a68fa7e7373` |
| `packages/workshop-frontend/src/styles.css` | `d14c1e4737b8e4d206e0f29c285f3285d43667d8` |
| `packages/workshop-frontend/src/routes/workspace.$id.tsx` | `1b4ed6ef122e678b72df074ec7673d0c8e045bf6` |

## Screenshot

The visual reference is copied to `reference/q3-planning-workspace.png` from upstream `docs/images/q3-planning-workspace.png` (blob SHA
`12363781a40fdd9eb50968b13ebfe7de8be9e251`). The README embeds it directly so the inspiration directory stays
text-first and reviewable.
