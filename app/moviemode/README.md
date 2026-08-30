# Movie Mode — dashboard product tree

**URL:** `/dashboard/moviemode/*`
**Product docs:** `docs/products/movie-mode/` · manifest `product-manifests/movie-mode.json`
**Backend:** `src/api/moviemode-api.js` · satellite `services/moviemode-service/`

This folder is the **only** Movie Mode SPA surface (was split across `features/moviemode` + `pages/moviemode`).

## Route → file map

| Route | Tab | Entry / UI | Status |
|-------|-----|------------|--------|
| `/dashboard/moviemode` | editor (no project) | `MovieModePage` → `MovieModeHome` | **Built** |
| `/dashboard/moviemode/projects` | projects | `MovieModeProjectsTab` | **Built** |
| `/dashboard/moviemode/templates` | templates | `MovieModePlaceholderTab` | **Thin / placeholder** |
| `/dashboard/moviemode/ai-studio` | ai-studio | `MovieModePlaceholderTab` | **Thin / placeholder** |
| `/dashboard/moviemode/:projectId` | editor | `MovieModeWorkbench` + studio/timeline | **Partial** (mobile editor pending) |

Route parsing: `movieModeRoutes.ts` · App mount: `app/App.tsx` lazy → `./moviemode/MovieModePage`.

## Module map (what lives here)

| Area | Files |
|------|--------|
| Shell / chrome | `MovieModePage`, `MovieModeBottomNav`, `MovieModeToolbar`, `MovieModeHome` |
| Projects | `MovieModeProjectsTab` |
| Placeholders | `MovieModePlaceholderTab` (templates + ai-studio) |
| Editor | `MovieModeWorkbench`, `MovieModeStudio`, `TimelineRail`, `TextOverlayEditor`, `ExportPanel` |
| Remotion | `MovieModeComposition`, `PreviewComposition`, `remotion-utils` · entry `app/src/remotion-entry.tsx` |
| Media bin | `MovieModeMediaPanel`, `MediaLibrary`, `movieModeMediaEvents` |
| Shared | `types`, `createEmptyTimeline`, `editSessionAdapter`, `useMovieModeShell` |

Hooks (shared, not duplicated here): `app/hooks/useMovieModeProject.ts`, `useMovieModeProjects.ts`
Shared types: `app/src/types/moviemode.ts`

## Known gaps (update when closing)

- [ ] `templates` / `ai-studio` still placeholder tabs (real Stream templates API exists server-side)
- [ ] Mobile editor refactor
- [ ] `route_key` missing in `dashboardRouteContext.ts`
- [ ] API offload to `moviemode-service` incomplete

## Do not

- Put Movie Mode UI back under `app/features/` or a second `pages/moviemode/` tree
- Mix Videos (`app/components/videos`) into this product
