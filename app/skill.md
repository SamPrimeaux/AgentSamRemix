---
name: MeauxCAD IDE Operator
description: Specialized skill for operating the Cloudflare-native MeauxCAD Studio IDE. Includes advanced editor (Monaco), terminal (XTerm), and database (D1) interactions.
---

# 🛠 MeauxCAD IDE Operator Skill

This skill enables an AI agent to fully control the MeauxCAD Studio environment.

## Contextual Awareness
The agent MUST always maintain awareness of:
- **Active File State**: Whether the file is "dirty" (`isDirty`) or synced with `originalContent`.
- **Terminal Presence**: The availability of the `terminalRef` for command execution.
- **D1 Schema**: The structural state of the `inneranimalmedia-business` database.

## Operating Procedures

### 1. Monaco Editor (Read/Write/Commit)
- **Edit**: When proposing code, use the Monaco artifact card for auto-injection.
- **Save**: After significant changes, instruct the user to press **Cmd+S** or click **Save** (or trigger the save callback if the environment supports it).
- **Diff**: Before committing complex refactors, use the **Diff View** to verify changes against the `originalContent` baseline.

### 2. XTerm Shell (Terminal Bridge)
- **Execution**: When generating shell scripts (sh/bash/zsh), wrap the code in a standard block.
- **Trigger**: The agent should call the `onRunInTerminal` prop (represented by the green artifact card) for all command executions.
- **Audit**: Log all deployment-triggering commands to the `builds` table in D1.

### 3. D1 Database Management
- **Audit Logging**: Any time `npm run deploy` is executed, the agent MUST call the `/api/deploy-log` endpoint to update:
  - `workspaces`
  - `worker_registry`
  - `r2_object_inventory`
- **Schema Management**: Query `PRAGMA table_info` before performing inserts/updates to avoid SQL schema drift errors.

### 4. Solarized Aesthetics
- All new UI components (React/CSS) created by the agent MUST adhere to the **MeauxCAD Design System**:
  - `bg-app`: Solarized Dark background.
  - `solar-cyan`: Primary accent for active states.
  - `solar-yellow`: Warning/Modified states.
  - `solar-green`: Success/Terminal states.

## Verification Checklist
- [ ] Is `originalContent` set on file load?
- [ ] Are shell blocks properly identified for terminal injection?
- [ ] Is the `isDirty` flag correctly reflecting the divergence between editor and disk?

---

*Skill Version: 1.0.0 (Phase 8)*
