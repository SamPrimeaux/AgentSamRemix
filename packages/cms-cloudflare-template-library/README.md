# CMS Cloudflare Template Library

Reusable application blocks and public-site blocks for Agent Sam customer builds.

The package deliberately separates **application UI** from **public-site UI**:

- `app-blocks/` composes Cloudflare Kumo primitives for dashboards, CMS/editor surfaces, settings, search, status, and resource management.
- `site-blocks/` is lightweight branded website composition. These blocks do not require a Cloudflare-dashboard visual language.
- `themes/` contains portable design tokens.
- `registry/` is machine-readable inventory for Agent Sam so generation can select known components instead of inventing one-off UI.
- `templates/` composes registry component IDs into reusable site recipes.

## Consumer setup

Kumo uses Tailwind v4 utilities. A consuming Tailwind v4 app must scan both Kumo and this package and import Kumo styles before Tailwind:

```css
@source "../node_modules/@cloudflare/kumo/dist/**/*.{js,jsx,ts,tsx}";
@source "../packages/cms-cloudflare-template-library/src/**/*.{js,jsx,ts,tsx}";
@import "@cloudflare/kumo/styles/tailwind";
@import "tailwindcss";
```

Adjust relative paths for the consuming stylesheet.

## Licensing

IAM-authored code in this package remains internal/proprietary unless separately released. Kumo is MIT-licensed; the upstream notice is retained under `LICENSES/cloudflare-kumo-MIT.txt` and summarized in `THIRD_PARTY_NOTICES.md`.
