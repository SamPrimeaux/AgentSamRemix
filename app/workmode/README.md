# Agent Sam Work Mode

Integrated product surface at `/dashboard/workmode`, ported from
[AgentSamWorkMode-Prototype](https://github.com/SamPrimeaux/AgentSamWorkMode-Prototype).

## Architecture

```
app/workmode/
├── WorkModePage.tsx          # Route entry — chat + work split layout
├── types.ts                  # Work Mode domain types
├── context/                  # Env-driven config (VITE_* + bootstrap overrides)
├── components/               # Ported prototype UI
├── data/                     # Mock fallbacks (presentations, brand, workspaces)
├── services/                 # Agent task engine (+ Gemini proxy fallback)
└── hooks/
    ├── useWorkModeGitBridge.ts       → /api/agent/git/status
    ├── useWorkModeTelemetryBridge.ts → /api/agent/telemetry
    └── useWorkModeShellBridge.ts     → IAM_TERMINAL_CONNECT (shell PTY)
```

## Real vs mock (current)

| Surface | Source |
|---------|--------|
| Git branch + changed files | Live `/api/agent/git/status` when authenticated |
| Telemetry tab | Local runs + `/api/agent/telemetry` poll |
| Terminal | Opens shell PTY via `IAM_TERMINAL_CONNECT`; drawer shows agent logs |
| Chat / artifacts | Prototype engine + `/api/gemini/chat`; presentations/brand still mock |
| ExecOS / PWA inspector | Mock (future: tunnel status + SW diagnostics) |

## Next wiring targets

1. Route chat sends through `/api/agent/chat` SSE (shell AgentSamChatHost)
2. Wire workbench PR review to GitHub API + `ApprovalUnifiedDiff`
3. Replace browser cards with `@iam/frontend/workbench/browser`
4. Connect presentations/websites to CMS + moviemode asset APIs
