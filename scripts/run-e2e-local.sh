#!/usr/bin/env bash
set -euo pipefail

# Turn colors in this script off by setting the NO_COLOR variable
NO_COLOR=${NO_COLOR:-""}
if [ -z "$NO_COLOR" ]; then
  header=$'\e[1;33m'
  reset=$'\e[0m'
  green=$'\e[0;32m'
  red=$'\e[0;31m'
  bold=$'\e[1m'
else
  header=''
  reset=''
  green=''
  red=''
  bold=''
fi

function header_text {
  echo "${header}$*${reset}"
}

function success_text {
  echo "${green}$*${reset}"
}

function error_text {
  echo "${red}$*${reset}"
}

function bold_text {
  echo "${bold}$*${reset}"
}

# Configuration
KEEP_CLUSTER=${KEEP_CLUSTER:-false}
LOCAL_OPERATOR_PATH=${LOCAL_OPERATOR_PATH:-"/Users/aliok/go/src/github.com/kubernetes-sigs/mcp-lifecycle-operator"}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Track test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
FAILED_SERVERS=()
START_TIME=$(date +%s)

bold_text "
╔══════════════════════════════════════════════════════════════╗
║          MCP E2E Test Suite (LOCAL OPERATOR)                 ║
╚══════════════════════════════════════════════════════════════╝
"

header_text "Using local operator from: ${LOCAL_OPERATOR_PATH}"
echo ""

# Cleanup function
cleanup() {
  local exit_code=$?

  if [ "${KEEP_CLUSTER}" != "true" ]; then
    header_text "[CLEANUP] Cleaning up resources..."
    "${SCRIPT_DIR}/cleanup.sh" || true
  else
    header_text "[CLEANUP] Keeping cluster for debugging (KEEP_CLUSTER=true)"
    echo "To cleanup manually, run: ${SCRIPT_DIR}/cleanup.sh"
  fi

  return $exit_code
}

# Register cleanup trap
trap cleanup EXIT

# 1. Setup cluster
header_text "
=== Phase 1: Cluster Setup ===
"
if ! "${PROJECT_ROOT}/cluster/setup.sh"; then
  error_text "Failed to setup cluster"
  exit 1
fi

# 2. Deploy operator from local directory
header_text "
=== Phase 2: Operator Deployment (Local) ===
"
export LOCAL_OPERATOR_PATH
if ! "${SCRIPT_DIR}/deploy-operator-local.sh"; then
  error_text "Failed to deploy operator"
  exit 1
fi

# 3. Build and load custom MCP server images
header_text "
=== Phase 3: Build Custom Images ===
"
if ! "${SCRIPT_DIR}/build-test-images.sh"; then
  error_text "Failed to build custom images"
  exit 1
fi

# 4. Run tests for each server (sequential, continue on failure)
header_text "
=== Phase 4: Server Tests ===
"

for server_dir in "${PROJECT_ROOT}"/test-servers/*/; do
  # Skip template directory
  if [ "$(basename "${server_dir}")" = "template" ]; then
    continue
  fi

  # Check if test file exists
  if [ ! -f "${server_dir}/test.ts" ]; then
    echo "Skipping $(basename "${server_dir}") - no test.ts found"
    continue
  fi

  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  SERVER_NAME=$(basename "${server_dir}")

  echo ""
  header_text "[SERVER ${TOTAL_TESTS}] Testing ${SERVER_NAME}..."
  echo ""

  # Check if this is a standalone test (no manifest.yaml)
  # Standalone tests manage their own resources and run test.ts directly
  if [ ! -f "${server_dir}/manifest.yaml" ]; then
    header_text "[STANDALONE TEST] Running ${SERVER_NAME} test directly..."

    # Run the test script directly (it manages its own deployment/cleanup)
    TEST_EXIT_CODE=0
    cd "${PROJECT_ROOT}/framework"
    npx tsx "${server_dir}/test.ts" 2>&1 | tee "${PROJECT_ROOT}/logs/${SERVER_NAME}-test-output.log" || TEST_EXIT_CODE=${PIPESTATUS[0]}

    if [ "${TEST_EXIT_CODE}" -eq 0 ]; then
      PASSED_TESTS=$((PASSED_TESTS + 1))
      success_text "✓ ${SERVER_NAME} passed"
    else
      FAILED_TESTS=$((FAILED_TESTS + 1))
      FAILED_SERVERS+=("${SERVER_NAME}")
      error_text "✗ ${SERVER_NAME} failed"
    fi
  else
    # Standard test with manifest.yaml - use test-server.sh
    if "${SCRIPT_DIR}/test-server.sh" "${server_dir}"; then
      PASSED_TESTS=$((PASSED_TESTS + 1))
      success_text "✓ ${SERVER_NAME} passed"
    else
      FAILED_TESTS=$((FAILED_TESTS + 1))
      FAILED_SERVERS+=("${SERVER_NAME}")
      error_text "✗ ${SERVER_NAME} failed"
    fi
  fi

  echo ""
done

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Print overall results
bold_text "
╔══════════════════════════════════════════════════════════════╗
║          Overall Results                                     ║
╚══════════════════════════════════════════════════════════════╝
"

echo "Servers tested: ${TOTAL_TESTS}"
echo "Tests passed:   ${green}${PASSED_TESTS}${reset}"
echo "Tests failed:   ${red}${FAILED_TESTS}${reset}"
echo "Duration:       ${DURATION}s"

if [ "${FAILED_TESTS}" -gt 0 ]; then
  echo ""
  error_text "Failed servers:"
  for server in "${FAILED_SERVERS[@]}"; do
    echo "  - ${server}"
  done
  echo ""
  error_text "Logs available in: ${PROJECT_ROOT}/logs/"
  echo ""
  bold_text "Exit code: 1 (failures detected)"
  exit 1
else
  echo ""
  success_text "All tests passed! ✓"
  echo ""
  bold_text "Exit code: 0 (success)"
  exit 0
fi