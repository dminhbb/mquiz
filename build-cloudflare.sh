#!/bin/sh
# Cloudflare Workers Static Assets build. The real build logic lives in
# scripts/build-static.js so every deployment path produces identical output.
# SPA routing is handled by wrangler.toml (not_found_handling = single-page-application).

set -e

echo "=== mquiz Cloudflare build ==="
node scripts/build-static.js
echo "=== Build complete. Output: dist/ ==="
ls -la dist/
