#!/usr/bin/env bash
set -e

# Resolve script directory and plugin root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -n "$CLAUDE_PLUGIN_ROOT" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/index.mjs" ]; then
  ENTRY="$CLAUDE_PLUGIN_ROOT/dist/index.mjs"
elif [ -f "$PLUGIN_ROOT/dist/index.mjs" ]; then
  ENTRY="$PLUGIN_ROOT/dist/index.mjs"
elif [ -f "$SCRIPT_DIR/dist/index.mjs" ]; then
  ENTRY="$SCRIPT_DIR/dist/index.mjs"
else
  echo "Error: Could not locate dist/index.mjs for codex-antigravity." >&2
  exit 1
fi

# Augment PATH with standard user & package manager locations (macOS / Linux GUI compatibility)
EXTRA_PATHS=(
  "/opt/homebrew/bin"
  "/usr/local/bin"
  "$HOME/.nvm/versions/node/$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -n 1)/bin"
  "$HOME/.local/share/fnm/current/bin"
  "$HOME/.fnm/current/bin"
  "$HOME/Library/Application Support/fnm/current/bin"
  "$HOME/.volta/bin"
  "$HOME/.asdf/shims"
  "$HOME/.local/share/pnpm"
  "$HOME/.bun/bin"
  "$HOME/.gemini/antigravity/bin"
  "$HOME/.gemini/antigravity-cli/bin"
  "$HOME/.local/bin"
  "$HOME/bin"
)

for p in "${EXTRA_PATHS[@]}"; do
  if [ -d "$p" ]; then
    PATH="$p:$PATH"
  fi
done
export PATH

# Locate Node.js executable
NODE_BIN=""

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  CANDIDATES=(
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "/usr/bin/node"
    "$HOME/.volta/bin/node"
  )
  for c in "${CANDIDATES[@]}"; do
    if [ -x "$c" ]; then
      NODE_BIN="$c"
      break
    fi
  done
fi

if [ -n "$NODE_BIN" ]; then
  exec "$NODE_BIN" "$ENTRY" "$@"
fi

# Fallback: check bun
if command -v bun >/dev/null 2>&1; then
  exec bun "$ENTRY" "$@"
fi

echo "Error: Node.js (v18+) is required to run codex-antigravity MCP plugin." >&2
echo "Please install Node.js from https://nodejs.org or via Homebrew ('brew install node')." >&2
exit 1
