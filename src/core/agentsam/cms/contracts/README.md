# CMS Contracts

`contracts/` defines the canonical capability language shared by agent surfaces and other CMS hosts.

Examples:
- `page.read`
- `section.update`
- `block.create`
- `theme.update`
- `preview.read`
- `publish.page`

Every capability carries a resource and risk class. Unknown capability names are rejected rather than passed through to provider output or arbitrary host behavior.

Destructive and publish capabilities are marked as approval-required at the generic CMS agent service boundary. Planning remains an agent responsibility rather than a separate catalog tool.
