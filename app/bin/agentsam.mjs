#!/usr/bin/env bash
# IAM operator CLI — package.json exposes only lifecycle + bin/agentsam.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/tools/agentsam/cli.mjs" "$@"
