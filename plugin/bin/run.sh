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

# 1. Locate existing Node.js executable on the system
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

# 2. Check fallback runtime: bun
if command -v bun >/dev/null 2>&1; then
  exec bun "$ENTRY" "$@"
fi

# 3. If Node is not installed at all, auto-download portable standalone Node.js (Plug & Play)
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/codex-antigravity"
NODE_VERSION="v20.18.0"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    PLATFORM="darwin"
    ;;
  Linux)
    PLATFORM="linux"
    ;;
  *)
    PLATFORM=""
    ;;
esac

case "$ARCH" in
  arm64|aarch64)
    ARCH_NAME="arm64"
    ;;
  x86_64|amd64)
    ARCH_NAME="x64"
    ;;
  *)
    ARCH_NAME=""
    ;;
esac

if [ -n "$PLATFORM" ] && [ -n "$ARCH_NAME" ]; then
  TARBALL_NAME="node-${NODE_VERSION}-${PLATFORM}-${ARCH_NAME}"
  STANDALONE_DIR="$CACHE_DIR/$TARBALL_NAME"
  STANDALONE_NODE="$STANDALONE_DIR/bin/node"

  if [ -x "$STANDALONE_NODE" ]; then
    exec "$STANDALONE_NODE" "$ENTRY" "$@"
  fi

  # Auto-fetch standalone Node.js archive
  mkdir -p "$CACHE_DIR"
  echo "Node.js not detected on system. Auto-downloading portable Node.js ($NODE_VERSION) for codex-antigravity..." >&2

  URL="https://nodejs.org/dist/${NODE_VERSION}/${TARBALL_NAME}.tar.gz"
  TMP_TAR="$CACHE_DIR/${TARBALL_NAME}.tar.gz"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$TMP_TAR"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TMP_TAR" "$URL"
  fi

  if [ -f "$TMP_TAR" ]; then
    tar -xzf "$TMP_TAR" -C "$CACHE_DIR" 2>/dev/null || true
    rm -f "$TMP_TAR"
    if [ -x "$STANDALONE_NODE" ]; then
      exec "$STANDALONE_NODE" "$ENTRY" "$@"
    fi
  fi
fi

echo "Error: Node.js (v18+) is required to run codex-antigravity MCP plugin." >&2
echo "Please install Node.js from https://nodejs.org or via Homebrew ('brew install node')." >&2
exit 1
