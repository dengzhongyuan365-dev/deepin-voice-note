#!/usr/bin/env bash
#
# Post-check wrapper: run a YouQu AT suite, then assert the DB result.
#
# YouQu YAML has no native shell-command action, so this script bridges the
# gap by running the suite first and invoking assert_tiptap_scenario_db.py
# as a mandatory post-check.  If either the suite or the DB assertion fails,
# the overall exit code is non-zero — the test cannot "pass" without DB proof.
#
# Usage:
#   tests/at/scripts/run_s005_with_db_check.sh \
#       tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_005_001_s1.suite.yaml \
#       tests/at/expected/tiptap_scenario_005_001_expected.yaml
#
# Environment:
#   DISPLAY must be set (desktop session required for AT-SPI).
#   sqlite3 and python3 must be on PATH.

set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <suite.yaml> <expected.yaml>" >&2
    exit 2
fi

SUITE_YAML="$1"
EXPECTED_YAML="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DB_ASSERT_SCRIPT="${SCRIPT_DIR}/assert_tiptap_scenario_db.py"

if [[ ! -f "${SUITE_YAML}" ]]; then
    echo "ERROR: suite YAML not found: ${SUITE_YAML}" >&2
    exit 2
fi
if [[ ! -f "${EXPECTED_YAML}" ]]; then
    echo "ERROR: expected YAML not found: ${EXPECTED_YAML}" >&2
    exit 2
fi
if [[ ! -f "${DB_ASSERT_SCRIPT}" ]]; then
    echo "ERROR: DB assertion script not found: ${DB_ASSERT_SCRIPT}" >&2
    exit 2
fi

if [[ -z "${DISPLAY:-}" ]]; then
    echo "ERROR: DISPLAY is not set — desktop session required for AT-SPI tests" >&2
    exit 2
fi

echo "========================================================"
echo "[1/2] Running YouQu AT suite: ${SUITE_YAML}"
echo "========================================================"
set +e
youqu at run --suite "${SUITE_YAML}"
SUITE_RC=$?
set -e

if [[ ${SUITE_RC} -ne 0 ]]; then
    echo "========================================================"
    echo "FAIL: suite execution failed (rc=${SUITE_RC}), skipping DB post-check"
    echo "========================================================"
    exit ${SUITE_RC}
fi

echo "========================================================"
echo "[2/2] Running DB post-check: ${EXPECTED_YAML}"
echo "========================================================"
set +e
python3 "${DB_ASSERT_SCRIPT}" "${EXPECTED_YAML}"
DB_RC=$?
set -e

if [[ ${DB_RC} -ne 0 ]]; then
    echo "========================================================"
    echo "FAIL: DB assertion failed (rc=${DB_RC}) — migration result not verified"
    echo "========================================================"
    exit ${DB_RC}
fi

echo "========================================================"
echo "PASS: suite + DB post-check both passed"
echo "========================================================"
exit 0
