#!/usr/bin/env bash
# scripts/deploy/build-tarball.sh
# Run in CI after `npm ci && npm run build`.
# Produces /tmp/deploy-source.tar.gz and /tmp/deploy-next.tar.gz.

set -euo pipefail
tar czf /tmp/deploy-source.tar.gz \
  --exclude=node_modules --exclude=.git --exclude='.env*' --exclude='.next' \
  .
tar czf /tmp/deploy-next.tar.gz .next
ls -lh /tmp/deploy-source.tar.gz /tmp/deploy-next.tar.gz
