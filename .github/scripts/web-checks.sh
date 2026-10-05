#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
python -m unittest discover -s scripts -p 'test_*.py'
pnpm build
pnpm test
if [[ ${CI:-} == true ]]; then
  pnpm --filter @zotstop/web exec playwright install --with-deps chromium
else
  pnpm --filter @zotstop/web exec playwright install chromium
fi
pnpm test:e2e
pnpm --filter @zotstop/edge-proxy exec wrangler deploy --dry-run
