#!/usr/bin/env bash
# Apply AgentSamRemix integration commits to a local clone and push to origin.
# Run from a machine with write access to SamPrimeaux/AgentSamRemix.
set -euo pipefail

PATCH_URL="${1:-https://raw.githubusercontent.com/SamPrimeaux/AgentSamWorkMode-Prototype/cursor/remix-integration-guide-8edb/patches/agentsamremix-full-integration.patch}"

if [[ ! -d .git ]]; then
  echo "Run inside an AgentSamRemix git clone."
  exit 1
fi

echo "Fetching patch from prototype repo..."
curl -fsSL "$PATCH_URL" -o /tmp/agentsamremix-integration.patch

git checkout -B cursor/integrate-workmode-ui-8edb
git am /tmp/agentsamremix-integration.patch

npm ci
npm run verify:mcp-bridge
npm run verify:sdk-cli
npm run test:bin-lib
npm run build

git push -u origin cursor/integrate-workmode-ui-8edb

echo "Done. Open PR: https://github.com/SamPrimeaux/AgentSamRemix/compare/main...cursor/integrate-workmode-ui-8edb"
