#!/usr/bin/env bash
# Builds jagir.mcpb, a Claude Desktop extension bundle (dist + production deps + manifest + icon).
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
manifest_version=$(node -p "require('./mcpb/manifest.json').version")
if [ "$version" != "$manifest_version" ]; then
  echo "package.json version ($version) != mcpb/manifest.json version ($manifest_version)" >&2
  exit 1
fi

npm run build
stage=build/mcpb
rm -rf "$stage" && mkdir -p "$stage"
cp -R dist mcpb/manifest.json mcpb/icon.png package.json package-lock.json README.md LICENSE "$stage"/
(cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && rm package-lock.json)
npx -y @anthropic-ai/mcpb@2 validate "$stage/manifest.json"
npx -y @anthropic-ai/mcpb@2 pack "$stage" jagir.mcpb
