#!/usr/bin/env bash
#
# run_s006_with_db_check.sh — 运行 S006 富文本格式化 suite 后执行 DB 断言。
#
# 用法:
#   ./tests/at/scripts/run_s006_with_db_check.sh [--smoke-args "..."]
#
# 流程:
#   1. 运行 youqu at smoke 对 S006 三条 suite 执行 AT-SPI 测试
#   2. 逐条执行 assert_tiptap_scenario_db.py 校验 DB 中目标笔记内容
#   3. 任一环节失败则退出码非零
#
# 环境要求: DISPLAY / AT-SPI bus 可用（需桌面环境）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MODULE_DIR="${PROJECT_ROOT}/tests/at/yaml/富文本格式化"
DB_SCRIPT="${SCRIPT_DIR}/assert_tiptap_scenario_db.py"
EXTRA_ARGS="${1:-}"

if [[ ! -d "${MODULE_DIR}" ]]; then
  echo "ERROR: module dir not found: ${MODULE_DIR}" >&2
  exit 1
fi

if [[ ! -f "${DB_SCRIPT}" ]]; then
  echo "ERROR: DB assertion script not found: ${DB_SCRIPT}" >&2
  exit 1
fi

if ! command -v youqu >/dev/null 2>&1; then
  echo "ERROR: youqu not found in PATH" >&2
  exit 1
fi

echo "=========================================="
echo "Step 1: Run S006 AT-SPI smoke tests"
echo "=========================================="

# Run each S006 suite individually so a failure in one doesn't skip the others
SUITES=(
  "case_S006_001_s1.suite.yaml"
  "case_S006_002_s1.suite.yaml"
  "case_S006_003_s1.suite.yaml"
)

SMOKE_FAILED=0
for suite_file in "${SUITES[@]}"; do
  suite_path="${MODULE_DIR}/${suite_file}"
  if [[ ! -f "${suite_path}" ]]; then
    echo "WARN: suite file not found, skipping: ${suite_path}" >&2
    continue
  fi
  echo "--- Running ${suite_file} ---"
  if ! youqu at smoke --modules-dir "${MODULE_DIR}" ${EXTRA_ARGS}; then
    echo "FAIL: smoke failed for ${suite_file}" >&2
    SMOKE_FAILED=1
  fi
done

echo ""
echo "=========================================="
echo "Step 2: Run DB assertions"
echo "=========================================="

# DB assertion parameters per scenario
# Format: "note_text|marks|node_types"
DB_CHECKS=(
  "richtextformat006|bold,italic,underline|"
  "strikeformat006|strike|"
  "listformat006||orderedList,bulletList"
)

DB_FAILED=0
for check in "${DB_CHECKS[@]}"; do
  IFS='|' read -r note_text marks node_types <<< "${check}"
  echo "--- DB check: note_text=${note_text} ---"
  args=(--note-text "${note_text}")
  if [[ -n "${marks}" ]]; then
    args+=(--marks-contains "${marks}")
  fi
  if [[ -n "${node_types}" ]]; then
    args+=(--node-type-contains "${node_types}")
  fi
  if ! python3 "${DB_SCRIPT}" "${args[@]}"; then
    echo "FAIL: DB assertion failed for note_text=${note_text}" >&2
    DB_FAILED=1
  fi
done

echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
echo "Smoke:  $([[ ${SMOKE_FAILED} -eq 0 ]] && echo PASS || echo FAIL)"
echo "DB:     $([[ ${DB_FAILED} -eq 0 ]] && echo PASS || echo FAIL)"

if [[ ${SMOKE_FAILED} -ne 0 || ${DB_FAILED} -ne 0 ]]; then
  echo "RESULT: FAILED" >&2
  exit 1
fi

echo "RESULT: ALL PASSED"
exit 0
