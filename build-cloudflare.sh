#!/bin/sh
# Build script for Cloudflare Workers Static Assets
# Merges frontend/ and cloud-admin/ into dist/
# SPA routing is handled by wrangler.toml (not_found_handling = single-page-application)

set -e

echo "=== mquiz Cloudflare Pages Build ==="

# Clean and create dist
rm -rf dist
mkdir -p dist

# Copy frontend to dist root
echo "[1/3] Copying frontend..."
cp -r frontend/. dist/

# Remove _redirects - not compatible with Cloudflare Workers Static Assets
# (SPA routing handled by not_found_handling in wrangler.toml)
rm -f dist/_redirects

# Copy cloud-admin to dist/admin
echo "[2/3] Copying cloud-admin..."
mkdir -p dist/admin
cp -r cloud-admin/. dist/admin/

echo "[3/3] Done."
echo "=== Build complete. Output: dist/ ==="
ls -la dist/
