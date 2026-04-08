#!/usr/bin/env bash
set -euo pipefail

# Turn colors in this script off by setting the NO_COLOR variable
NO_COLOR=${NO_COLOR:-""}
if [ -z "$NO_COLOR" ]; then
  header=$'\e[1;33m'
  reset=$'\e[0m'
  green=$'\e[0;32m'
else
  header=''
  reset=''
  green=''
fi

function header_text {
  echo "${header}$*${reset}"
}

function success_text {
  echo "${green}$*${reset}"
}

# Configuration
OPERATOR_REF=${OPERATOR_REF:-"main"}
OPERATOR_REPO=${OPERATOR_REPO:-"https://github.com/kubernetes-sigs/mcp-lifecycle-operator"}
KIND_CLUSTER_NAME=${KIND_CLUSTER_NAME:-"kind"}
OPERATOR_IMAGE=${OPERATOR_IMAGE:-"mcp-operator:test"}
GITHUB_TOKEN=${GITHUB_TOKEN:-""}

header_text "[OPERATOR] Building and deploying MCP lifecycle operator from source (ref: ${OPERATOR_REF})"

# Create temporary directory for operator build
OPERATOR_DIR=$(mktemp -d)
trap "rm -rf ${OPERATOR_DIR}" EXIT

header_text "[OPERATOR] Cloning operator repository..."
# If GITHUB_TOKEN is provided, use it for authentication
if [ -n "${GITHUB_TOKEN}" ]; then
  # Replace https://github.com with https://token@github.com for authenticated access
  AUTH_REPO=$(echo "${OPERATOR_REPO}" | sed "s|https://github.com|https://${GITHUB_TOKEN}@github.com|")
  git clone --quiet "${AUTH_REPO}" "${OPERATOR_DIR}"
else
  git clone --quiet "${OPERATOR_REPO}" "${OPERATOR_DIR}"
fi
cd "${OPERATOR_DIR}"

header_text "[OPERATOR] Checking out ref: ${OPERATOR_REF}"
# If ref looks like a PR ref (refs/pull/123/head), fetch it explicitly
if [[ "${OPERATOR_REF}" =~ ^refs/pull/[0-9]+/(head|merge)$ ]]; then
  header_text "[OPERATOR] Fetching PR ref from upstream..."
  git fetch origin "${OPERATOR_REF}:pr-ref"
  git checkout --quiet pr-ref
else
  git checkout --quiet "${OPERATOR_REF}"
fi

header_text "[OPERATOR] Building operator Docker image..."
make docker-build IMG="${OPERATOR_IMAGE}"

header_text "[OPERATOR] Loading image into Kind cluster..."
kind load docker-image "${OPERATOR_IMAGE}" --name "${KIND_CLUSTER_NAME}"

header_text "[OPERATOR] Deploying operator to cluster..."
make deploy IMG="${OPERATOR_IMAGE}"

header_text "[OPERATOR] Waiting for operator to be ready..."
kubectl wait --for=condition=Available deployment/mcp-lifecycle-operator-controller-manager \
  -n mcp-lifecycle-operator-system --timeout=300s

success_text "[OPERATOR] ✓ Operator deployed and ready"
