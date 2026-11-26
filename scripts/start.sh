#!/usr/bin/env bash
# KaneGuard judge-friendly local launch. No package installs without consent.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if ! command -v node >/dev/null 2>&1; then
  echo 'KaneGuard requires Node.js 20 or newer. Install Node.js first.' >&2
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0])<20) {console.error("KaneGuard requires Node.js 20+; found " + process.version); process.exit(1)}'
for command in kane-cli agent cursor-agent agy claude codex; do
  if command -v "$command" >/dev/null 2>&1; then printf '  ✓ %-14s %s\n' "$command" "$(command -v "$command")"; fi
done
if ! command -v kane-cli >/dev/null 2>&1; then
  echo '  ! kane-cli is not installed. You can open the UI, but real browser verification requires Kane CLI.' >&2
  echo '    Install: npm install -g @testmuai/kane-cli && kane-cli login' >&2
fi
if ! command -v agent >/dev/null 2>&1 && ! command -v cursor-agent >/dev/null 2>&1 && ! command -v agy >/dev/null 2>&1 && ! command -v claude >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1; then
  echo '  ! No supported coding agent found. Install and authenticate at least one CLI.' >&2
fi
echo "Starting KaneGuard Studio: http://127.0.0.1:${PORT:-4173}/control/"
exec node server/main.mjs
