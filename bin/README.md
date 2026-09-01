# Operator entrypoints

`bin/` is the repo's operator/CLI surface. Browser code does not own deploy or
operator commands, and backend domain modules may provide implementations without
becoming their own scattered executable entrypoints.

Primary entrypoint:

```text
bin/agentsam
├── context|init|status|db|tui|start-local|tunnel|identity|shell  → installed SDK CLI
├── acp serve                                      → Remix host command
├── deploy full|fast|worker                        → Remix host command (overrides SDK deploy)
├── eval retrieval                                 → Remix host command
├── sdk status                                     → SDK integration status
└── website sync|watch|status|verify|rollback      → Remix host command
```

Portable verbs and `--version` resolve the executable declared by the installed
`@inneranimalmedia/agentsam-sdk` package. Any verb that is not a Remix host command
(`acp`, `deploy`, `eval`, `sdk`, `website`) is forwarded to the SDK CLI automatically.
Remix does not copy SDK command implementations.

Supporting executable implementations currently live in `bin/deploy` and
`bin/website-assets.mjs`; command dispatch modules live in `bin/commands/`.
Development/test-only guards and evaluation harnesses may remain in `scripts/`.

## bin/lib ownership

`bin/lib/` is allowed to contain AgentSamRemix host helpers and short-lived SDK
incubation code, but it must never become a second AgentSam SDK.

Every `.mjs` file under `bin/lib/` is classified in `bin/lib/sdk-boundary.mjs` as:

- `host-only` — intentionally tied to this repository/runtime; or
- `sdk-candidate` — portable code that has a target path and tracking issue in
  `SamPrimeaux/agentsam-sdk`.

CI runs `npm run guard:sdk-boundary` and fails when a new `bin/lib` module is
unclassified or when an SDK candidate has no canonical SDK handoff. Current
portable work is tracked in `SamPrimeaux/agentsam-sdk#10`.

After an SDK candidate is implemented in `agentsam-sdk` and published in
`@inneranimalmedia/agentsam-sdk`, replace the Remix implementation with the SDK
import/shim and reclassify or remove the local file.

`bin/agentsam sdk status` prints the declared/installed SDK version and every
outstanding promotion target.
