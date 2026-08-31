# Kumo UI modernization

This branch adopts Cloudflare Kumo as a **generic application-UI primitive layer**, not as a replacement for Agent Sam product behavior or as a public-site brand system.

## Rules

1. Keep AgentSamRemix runtime/domain behavior where it already works.
2. Replace repeated dialog, navigation, feedback, loading, copy, and search presentation with maintained primitives.
3. Put reusable IAM composition in `packages/cms-cloudflare-template-library/`.
4. Keep customer public-site blocks separate from dashboard/application blocks.
5. Do not introduce a second CMS/workspace identity authority.
6. Preserve Kumo's MIT notice for upstream software while keeping IAM-authored composition separate.

## Current branch status

| Surface | Baseline | Branch result |
| --- | ---: | --- |
| `UnifiedSearchBar.tsx` | 2,222 LOC | Reduced to ~1,675 LOC; Kumo `CommandPalette` owns dialog/results/keyboard presentation and ~450 LOC of pure query/result modeling moved to `components/unified-search/paletteModel.ts`. Existing search sources/actions remain AgentSamRemix-owned. |
| `PwaUpdateBanner.tsx` | 121 LOC | Reduced to ~70 LOC; product update logic retained; Kumo-backed reusable `AppBanner` owns presentation. |
| `InstallCoach.tsx` | 76 LOC | Reduced to ~35 LOC; iOS detection/dismissal retained; reusable `AppBanner` owns presentation and safe-area placement. |
| CMS root | parked iframe | `/dashboard/cms` now exposes the reusable template/component library; authoring routes remain parked. |
| CMS templates | parked iframe | `/dashboard/cms/templates` now exposes registry-backed recipes and previews. |
| Shared package | none | New app/site blocks, IAM theme tokens, component registry, template registry, Kumo licensing notice. |

## Next mega-file candidates

These are intentionally **not** bulk-rewritten on this branch. Each should keep its behavior while its generic presentation is peeled onto the shared library.

| Priority | File | Why |
| --- | --- | --- |
| 1 | `app/pages/cms/SiteDeployWizard.tsx` | Very large wizard; strong fit for shared form, banner, copy, status, dialog, and step primitives. |
| 2 | `app/components/settings/sections/ApiKeysSection.tsx` | Strong `ClipboardField`, inputs, dialogs, banners, and secret-state cleanup candidate. |
| 3 | `app/components/shell/AppShellFrame.tsx` | Kumo `Sidebar` can absorb generic responsive/collapse mechanics without replacing Agent Sam surfaces. |
| 4 | `app/components/ChatAssistant/ContextHubDrawer.tsx` | Drawer/navigation mechanics can be standardized while preserving context behavior. |
| 5 | `app/pages/cms/cmsShell.css` | Reduce one-off shell styling after the live CMS surfaces have moved to reusable primitives. |
| 6 | `app/components/settings/hooks/useSettingsData.ts` | Behavior mega-file; should split by settings domain, not be “fixed” by a UI component library. |

## Explicit non-goals

- Replacing Monaco with a static code component.
- Replacing Agent Sam SSE/tool/browser/terminal behavior.
- Making every customer public website look like Cloudflare Dashboard.
- Copying Kumo source wholesale when a package dependency is cleaner.
- Reconnecting CMS authoring APIs before their domain ownership is clear.
