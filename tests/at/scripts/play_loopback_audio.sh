#!/usr/bin/env bash
# Play fixture audio into the default sink for internal/loopback recording.
# Intended for youqu action: command (NOT session_start — session_start overwrites
# app_process and breaks later AT-SPI lookups with 应用程序未启动).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
A="${1:-$ROOT/tests/at/fixtures/tengwanggexu.mp3}"
SECS="${2:-5}"
if command -v ffplay >/dev/null 2>&1; then
  timeout "${SECS}s" ffplay -nodisp -autoexit -loglevel quiet "$A" || true
elif command -v paplay >/dev/null 2>&1; then
  timeout "${SECS}s" paplay "$A" || true
else
  timeout "${SECS}s" xdg-open "$A" || true
fi
