# CMS Pages domain

`pages/` owns page identity, metadata, route uniqueness, status and archive/restore behavior.

Canonical homepage identity is `route_path === "/"`. `page_type: "home"` is the semantic classification. The canonical page contract does not expose or depend on the legacy `is_homepage` column.

Page content rendering, sections/blocks, R2 draft/published artifacts, and publish promotion are separate domains/adapters.
