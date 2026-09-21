#!/usr/bin/env bash
#
# Run a S005 YouQu AT suite and then run mandatory DB post-check.
# The test is considered passed only when both UI execution and DB assertion pass.
#
# Usage:
#   tests/at/scripts/run_s005_with_db_check.sh \
#     tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_005_001_s1.suite.yaml \
#     tests/at/expected/tiptap_scenario_005_001_expected.yaml
#
# Optional:
#   YOUQU_CMD="PYTHONPATH=/path/to/youqu python3 -m youqu.cli.main" \
#     tests/at/scripts/run_s005_with_db_check.sh <suite> <expected>

set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <suite.yaml> <expected.yaml>" >&2
    exit 2
fi

SUITE_YAML="$1"
EXPECTED_YAML="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
DB_ASSERT_SCRIPT="${SCRIPT_DIR}/assert_tiptap_scenario_db.py"

cd "${PROJECT_ROOT}"

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
if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "ERROR: sqlite3 is required for DB assertion" >&2
    exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 is required for DB assertion" >&2
    exit 2
fi

run_youqu_at_suite()
{
    # The console entry `youqu at run` currently does not reliably propagate
    # the runner return code in all local environments.  Call run_tests()
    # directly so a failed suite stops this wrapper before DB post-check.
    local extra_pythonpath=""
    if [[ -d "${HOME}/.local/lib/python3.12/site-packages/youqu" ]]; then
        extra_pythonpath="${HOME}/.local/lib/python3.12/site-packages/youqu"
    fi

    PYTHONPATH="${extra_pythonpath}${extra_pythonpath:+${PYTHONPATH:+:}}${PYTHONPATH:-}" \
        python3 - "${SUITE_YAML}" <<'PY'
import sys
from youqu.src.at.executor.runner import run_tests

suite = sys.argv[1]
sys.exit(run_tests(test_dir="tests/at/yaml", suite=suite))
PY
}

echo "========================================================"
echo "[1/2] Running YouQu AT suite: ${SUITE_YAML}"
echo "========================================================"
run_youqu_at_suite

echo "========================================================"
echo "[2/2] Running DB post-check: ${EXPECTED_YAML}"
echo "========================================================"
python3 "${DB_ASSERT_SCRIPT}" "${EXPECTED_YAML}"

echo "========================================================"
echo "PASS: suite + DB post-check both passed"
echo "========================================================"
