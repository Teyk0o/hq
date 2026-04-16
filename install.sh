#!/usr/bin/env bash
#
# HQ one-shot installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Teyk0o/hq/main/install.sh | bash
#
# Or, from a local clone:
#   ./install.sh
#
# What it does:
#   1. Installs tmux and bubblewrap via apt / dnf / brew (if missing)
#   2. Installs Bun (if missing)
#   3. Enables unprivileged user namespaces on Ubuntu 24+ (needed by bwrap)
#   4. Clones HQ into ~/.local/share/hq (or updates if already there)
#   5. Builds a single static binary into ~/.local/bin/hq
#   6. Warns if Claude Code CLI is not installed (you still need it)
#
# Environment overrides:
#   HQ_DIR      target clone dir (default: ~/.local/share/hq)
#   HQ_REF      git ref to check out (default: main)
#

set -euo pipefail

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
log()  { printf "${G}[hq]${N} %s\n" "$*"; }
warn() { printf "${Y}[hq]${N} %s\n" "$*"; }
die()  { printf "${R}[hq]${N} %s\n" "$*" >&2; exit 1; }

# ---------- OS + package manager detection ----------
case "$(uname -s)" in
  Linux*)  OS=linux ;;
  Darwin*) OS=macos ;;
  *)       die "unsupported OS: $(uname -s)" ;;
esac

if command -v apt-get >/dev/null 2>&1; then PKG=apt
elif command -v dnf   >/dev/null 2>&1; then PKG=dnf
elif command -v brew  >/dev/null 2>&1; then PKG=brew
else                                      PKG=none
fi

pkg_install() {
  local name="$1"
  case "$PKG" in
    apt)  sudo apt-get update -qq && sudo apt-get install -y "$name" ;;
    dnf)  sudo dnf install -y "$name" ;;
    brew) brew install "$name" ;;
    *)    die "no known package manager — install '$name' manually and re-run" ;;
  esac
}

# ---------- 1. tmux + bwrap ----------
if ! command -v tmux >/dev/null 2>&1; then
  log "installing tmux"
  pkg_install tmux
fi

if [ "$OS" = "linux" ]; then
  if ! command -v bwrap >/dev/null 2>&1; then
    log "installing bubblewrap"
    pkg_install bubblewrap
  fi
else
  warn "bubblewrap is Linux-only; the sandbox layer will be disabled on macOS"
fi

# ---------- 2. Bun ----------
if ! command -v bun >/dev/null 2>&1; then
  log "installing Bun"
  curl -fsSL https://bun.sh/install | bash >/dev/null
  export PATH="$HOME/.bun/bin:$PATH"
fi

# ---------- 3. userns on Ubuntu 24+ ----------
if [ "$OS" = "linux" ] && command -v bwrap >/dev/null 2>&1; then
  if ! bwrap --unshare-user --ro-bind / / true >/dev/null 2>&1; then
    warn "enabling unprivileged user namespaces (Ubuntu 24+ AppArmor tweak)"
    echo "kernel.apparmor_restrict_unprivileged_userns = 0" \
      | sudo tee /etc/sysctl.d/60-userns.conf >/dev/null
    sudo sysctl --system >/dev/null
  fi
fi

# ---------- 4. Clone + build ----------
HQ_DIR="${HQ_DIR:-$HOME/.local/share/hq}"
HQ_REF="${HQ_REF:-main}"

if [ -d "$HQ_DIR/.git" ]; then
  log "updating HQ at $HQ_DIR"
  git -C "$HQ_DIR" fetch --quiet origin
  git -C "$HQ_DIR" checkout --quiet "$HQ_REF"
  git -C "$HQ_DIR" pull --ff-only --quiet
else
  log "cloning HQ into $HQ_DIR"
  mkdir -p "$(dirname "$HQ_DIR")"
  git clone --quiet --branch "$HQ_REF" \
    https://github.com/Teyk0o/hq.git "$HQ_DIR"
fi

cd "$HQ_DIR"

log "installing dependencies (this takes ~30s)"
bun install --silent

log "building binary"
bun run build:bin >/dev/null

mkdir -p "$HOME/.local/bin"
install -m0755 dist/hq "$HOME/.local/bin/hq"

# ---------- 5. Claude Code check ----------
if ! command -v claude >/dev/null 2>&1; then
  warn "Claude Code CLI not found — install it from https://claude.com/claude-code"
  warn "HQ can run without it but every agent will fail at spawn time."
fi

# ---------- 6. PATH hint ----------
case ":$PATH:" in
  *":$HOME/.local/bin:"*) : ;;
  *)
    warn "$HOME/.local/bin is not on your PATH — add this to your shell rc:"
    warn '  export PATH="$HOME/.local/bin:$PATH"'
    ;;
esac

echo
log "installed. next steps:"
echo "    hq --help                       # commands"
echo "    cd ~/my-project && hq init      # scaffold a project"
echo "    hq daemon start                 # start the UI on http://127.0.0.1:7433"
