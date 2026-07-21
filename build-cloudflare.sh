#!/bin/sh
# Build script for Cloudflare Pages
# Merges frontend/ and cloud-admin/ into dist/

set -e

echo "=== mquiz Cloudflare Pages Build ==="

# Clean and create dist
rm -rf dist
mkdir -p dist

# Copy frontend to dist root
echo "[1/3] Copying frontend..."
cp -r frontend/. dist/

# Copy cloud-admin to dist/admin
echo "[2/3] Copying cloud-admin..."
mkdir -p dist/admin
cp -r cloud-admin/. dist/admin/

# Ensure _redirects exists at root (already in frontend/)
if [ -f dist/_redirects ]; then
  echo "[3/3] _redirects already present."
else
  echo "[3/3] Creating _redirects..."
  printf '/admin/*    /admin/index.html   200\n/*           /index.html         200\n' > dist/_redirects
fi

echo "=== Build complete. Output: dist/ ==="
ls -la dist/
