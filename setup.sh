#!/usr/bin/env bash
set -euo pipefail

# Thinking Desk — First-time setup
# Usage: ./setup.sh [--with-db]
#
# --with-db   Also start the Postgres container via docker compose.

echo "=== Thinking Desk Setup ==="

# ── Prerequisites ────────────────────────────────────────────────────────────

command -v node >/dev/null 2>&1 || {
  echo "Error: Node.js is required (20+). https://nodejs.org"
  exit 1
}

command -v pnpm >/dev/null 2>&1 || {
  echo "Error: pnpm is required (9+). https://pnpm.io/installation"
  exit 1
}

# ── Environment ───────────────────────────────────────────────────────────────

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — add at least one AI provider key before running pnpm dev."
else
  echo ".env already exists — skipping."
fi

# ── Dependencies ──────────────────────────────────────────────────────────────

echo "Installing dependencies..."
pnpm install

# ── Optional Postgres ─────────────────────────────────────────────────────────

if [[ "${1:-}" == "--with-db" ]]; then
  command -v docker >/dev/null 2>&1 || {
    echo "Error: Docker is required for --with-db."
    exit 1
  }
  echo "Starting Postgres..."
  docker compose up -d db
  echo "Postgres is up. schema.sql is applied automatically on first start."
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env — add at least one AI provider key"
echo "  2. Run:   pnpm dev"
echo "  3. Open:  http://localhost:3000"
echo ""
echo "Optional Postgres:"
echo "  ./setup.sh --with-db    # starts docker compose db service"
echo "  docker compose up -d db # or manually"
echo ""
echo "Using Claude Code? CLAUDE.md has full project context."
