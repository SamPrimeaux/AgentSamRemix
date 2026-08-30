# Operator entrypoints

`bin/` is the repo's operator/CLI surface. Browser code does not own deploy or
operator commands, and backend domain modules may provide implementations without
becoming their own scattered executable entrypoints.

Primary entrypoint:

```text
bin/agentsam
├── acp serve
├── deploy full|fast|worker
└── website sync|watch|status|verify|rollback
```

Supporting executable implementations currently live in `bin/deploy` and
`bin/website-assets.mjs`; command dispatch modules live in `bin/commands/`.
Development/test-only guards and evaluation harnesses may remain in `scripts/`.
