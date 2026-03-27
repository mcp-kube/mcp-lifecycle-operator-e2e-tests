#!/usr/bin/env bash
set -euo pipefail

# Turn colors in this script off by setting the NO_COLOR variable
NO_COLOR=${NO_COLOR:-""}
if [ -z "$NO_COLOR" ]; then
  header=$'\e[1;33m'
  reset=$'\e[0m'
  green=$'\e[0;32m'
  red=$'\e[0;31m'
else
  header=''
  reset=''
  green=''
  red=''
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

# Configuration
SERVER_DIR="$(cd "${1:?Server directory required}" && pwd)"
SERVER_NAME=$(basename "${SERVER_DIR}")
MANIFEST="${SERVER_DIR}/manifest.yaml"
TEST_FILE="${SERVER_DIR}/test.ts"
SERVER_READY_TIMEOUT=${SERVER_READY_TIMEOUT:-300}
PORT_FORWARD_TIMEOUT=${PORT_FORWARD_TIMEOUT:-10}
KEEP_FAILED_SERVERS=${KEEP_FAILED_SERVERS:-false}

# Get project root (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOGS_DIR="${PROJECT_ROOT}/logs"

# Ensure logs directory exists
mkdir -p "${LOGS_DIR}"

# Validate inputs
if [ ! -f "${MANIFEST}" ]; then
  error_text "[ERROR] Manifest not found: ${MANIFEST}"
  exit 1
fi

if [ ! -f "${TEST_FILE}" ]; then
  error_text "[ERROR] Test file not found: ${TEST_FILE}"
  exit 1
fi

header_text "[SERVER] Testing ${SERVER_NAME}..."

# Extract namespace from manifest (default to 'default' if not found)
NAMESPACE=$(grep -A 5 "kind: MCPServer" "${MANIFEST}" | grep "namespace:" | head -1 | awk '{print $2}' || echo "default")

# Deploy the MCP server
header_text "[DEPLOY] Applying manifest..."
kubectl apply -f "${MANIFEST}"

# Wait for MCPServer to be ready
header_text "[DEPLOY] Waiting for MCPServer to be ready (timeout: ${SERVER_READY_TIMEOUT}s)..."
if ! kubectl wait --for=condition=Ready "mcpserver/${SERVER_NAME}" -n "${NAMESPACE}" --timeout="${SERVER_READY_TIMEOUT}s" 2>&1; then
  error_text "[DEPLOY] MCPServer failed to become ready"
  kubectl describe "mcpserver/${SERVER_NAME}" -n "${NAMESPACE}" > "${LOGS_DIR}/${SERVER_NAME}-describe.txt" 2>&1 || true

  # Try to get deployment name from MCPServer status for log collection
  DEPLOYMENT_NAME=$(kubectl get "mcpserver/${SERVER_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.deploymentName}' 2>/dev/null || echo "${SERVER_NAME}")
  kubectl logs "deployment/${DEPLOYMENT_NAME}" -n "${NAMESPACE}" --tail=-1 --all-containers=true > "${LOGS_DIR}/${SERVER_NAME}.log" 2>&1 || true

  if [ "${KEEP_FAILED_SERVERS}" != "true" ]; then
    kubectl delete -f "${MANIFEST}" --ignore-not-found=true
  fi
  exit 1
fi

success_text "[DEPLOY] ✓ MCPServer is ready"

# Get service name from MCPServer status
header_text "[DEPLOY] Getting service name from MCPServer status..."
SERVICE_NAME=""
for i in {1..30}; do
  SERVICE_NAME=$(kubectl get "mcpserver/${SERVER_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.serviceName}' 2>/dev/null || echo "")
  if [ -n "${SERVICE_NAME}" ]; then
    break
  fi
  sleep 1
done

if [ -z "${SERVICE_NAME}" ]; then
  error_text "[DEPLOY] Failed to get service name from MCPServer status"
  kubectl describe "mcpserver/${SERVER_NAME}" -n "${NAMESPACE}" > "${LOGS_DIR}/${SERVER_NAME}-describe.txt" 2>&1 || true

  if [ "${KEEP_FAILED_SERVERS}" != "true" ]; then
    kubectl delete -f "${MANIFEST}" --ignore-not-found=true
  fi
  exit 1
fi

success_text "[DEPLOY] ✓ Service name: ${SERVICE_NAME}"

# Start port-forward
header_text "[DEPLOY] Port-forwarding to localhost:8080..."
kubectl port-forward "svc/${SERVICE_NAME}" 8080:8080 -n "${NAMESPACE}" > /dev/null 2>&1 &
PF_PID=$!

# Ensure port-forward cleanup on exit
cleanup_port_forward() {
  if [ -n "${PF_PID:-}" ]; then
    kill "${PF_PID}" 2>/dev/null || true
    wait "${PF_PID}" 2>/dev/null || true
  fi
}
trap cleanup_port_forward EXIT

# Wait for port-forward to be ready
sleep "${PORT_FORWARD_TIMEOUT}"
success_text "[DEPLOY] ✓ Port-forward established"

# Run tests
header_text "[TEST] Running tests..."
TEST_EXIT_CODE=0
cd "${PROJECT_ROOT}/framework"

# Run tests and capture output to both console and log file
npx tsx "${TEST_FILE}" 2>&1 | tee "${LOGS_DIR}/${SERVER_NAME}-test-output.log" || TEST_EXIT_CODE=${PIPESTATUS[0]}

# Collect logs (always)
header_text "[LOGS] Collecting server logs..."
# Get deployment name from MCPServer status
DEPLOYMENT_NAME=$(kubectl get "mcpserver/${SERVER_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.deploymentName}' 2>/dev/null || echo "${SERVER_NAME}")
# Get logs from all pods in the deployment
kubectl logs "deployment/${DEPLOYMENT_NAME}" -n "${NAMESPACE}" --tail=-1 --all-containers=true > "${LOGS_DIR}/${SERVER_NAME}-pod.log" 2>&1 || true
kubectl describe "mcpserver/${SERVER_NAME}" -n "${NAMESPACE}" > "${LOGS_DIR}/${SERVER_NAME}-describe.txt" 2>&1 || true

# Cleanup port-forward
cleanup_port_forward
trap - EXIT

# Cleanup server (unless KEEP_FAILED_SERVERS=true and tests failed)
if [ "${TEST_EXIT_CODE}" -ne 0 ] && [ "${KEEP_FAILED_SERVERS}" = "true" ]; then
  error_text "[CLEANUP] Tests failed - keeping server deployed for inspection (KEEP_FAILED_SERVERS=true)"
  error_text "[CLEANUP] To cleanup manually: kubectl delete -f ${MANIFEST}"
else
  header_text "[CLEANUP] Removing MCP server..."
  kubectl delete -f "${MANIFEST}" --ignore-not-found=true

  # Wait for deletion to complete
  kubectl wait --for=delete "mcpserver/${SERVER_NAME}" -n "${NAMESPACE}" --timeout=60s 2>/dev/null || true
  success_text "[CLEANUP] ✓ MCP server removed"
fi

# Exit with test result code
if [ "${TEST_EXIT_CODE}" -ne 0 ]; then
  error_text "[RESULT] Tests failed for ${SERVER_NAME}"
else
  success_text "[RESULT] ✓ Tests passed for ${SERVER_NAME}"
fi

exit "${TEST_EXIT_CODE}"
