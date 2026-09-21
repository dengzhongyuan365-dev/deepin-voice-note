#!/usr/bin/env bash
# Run all S005 Summernote -> Tiptap migration scenarios with DB post-checks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
RUN_ONE="${SCRIPT_DIR}/run_s005_with_db_check.sh"

cd "${PROJECT_ROOT}"

"${RUN_ONE}" \
  "tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_005_001_s1.suite.yaml" \
  "tests/at/expected/tiptap_scenario_005_001_expected.yaml"

"${RUN_ONE}" \
  "tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_005_002_s1.suite.yaml" \
  "tests/at/expected/tiptap_scenario_005_002_expected.yaml"

"${RUN_ONE}" \
  "tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_005_003_s1.suite.yaml" \
  "tests/at/expected/tiptap_scenario_005_003_expected.yaml"
