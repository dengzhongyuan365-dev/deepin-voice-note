#!/usr/bin/env bash
# Play fixture audio into the default Pulse sink so 设备内播放 (sink.monitor)
# can record it. ffplay's default backend bypasses Pulse and the monitor stays silent.
# Intended for youqu action: command (NOT session_start — session_start overwrites
# app_process and breaks later AT-SPI lookups with 应用程序未启动).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
A="${1:-$ROOT/tests/at/fixtures/tengwanggexu.mp3}"
SECS="${2:-5}"

_sink_is_null() {
    local name="${1:-}"
    [[ -z "${name}" ]] && return 0
    [[ "${name}" == *null* ]] && return 0
    return 1
}

SINK="$(pactl get-default-sink 2>/dev/null || true)"
if _sink_is_null "${SINK}"; then
    SINK="$(pactl list short sinks 2>/dev/null | awk '$2 !~ /null/i {print $2; exit}')"
fi
if [[ -n "${SINK}" ]]; then
    pactl set-default-sink "${SINK}" >/dev/null 2>&1 || true
    pactl set-sink-mute "${SINK}" 0 >/dev/null 2>&1 || true
    pactl set-sink-volume "${SINK}" 80% >/dev/null 2>&1 || true
fi
echo "play_loopback sink=${SINK:-default} file=${A} secs=${SECS}"

set +e
if command -v ffmpeg >/dev/null 2>&1; then
    timeout "${SECS}s" ffmpeg -nostdin -hide_banner -loglevel error -i "${A}" -f pulse "${SINK:-default}"
    status=$?
elif command -v ffplay >/dev/null 2>&1; then
    timeout "${SECS}s" env SDL_AUDIODRIVER=pulse ffplay -nodisp -autoexit -loglevel quiet "${A}"
    status=$?
elif command -v paplay >/dev/null 2>&1; then
    timeout "${SECS}s" paplay ${SINK:+--device="${SINK}"} "${A}"
    status=$?
else
    echo "play_loopback: no ffmpeg, ffplay, or paplay" >&2
    exit 1
fi
set -e
# timeout exits 124 after the requested length. That is a complete play.
if [[ "${status}" -ne 0 && "${status}" -ne 124 ]]; then
    echo "play_loopback failed status=${status}" >&2
    exit "${status}"
fi
