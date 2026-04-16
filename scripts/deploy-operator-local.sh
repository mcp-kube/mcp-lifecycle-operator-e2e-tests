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
LOCAL_OPERATOR_PATH=${LOCAL_OPERATOR_PATH:-"/Users/aliok/go/src/github.com/kubernetes-sigs/mcp-lifecycle-operator"}
KIND_CLUSTER_NAME=${KIND_CLUSTER_NAME:-"kind"}
OPERATOR_IMAGE=${OPERATOR_IMAGE:-"mcp-operator:test"}

# Expand ~ to home directory if present
LOCAL_OPERATOR_PATH="${LOCAL_OPERATOR_PATH/#\~/$HOME}"

if [ ! -d "${LOCAL_OPERATOR_PATH}" ]; then
  echo "Error: Local operator directory not found: ${LOCAL_OPERATOR_PATH}"
  echo "Set LOCAL_OPERATOR_PATH environment variable to point to your local operator clone"
  exit 1
fi

header_text "[OPERATOR] Building and deploying MCP lifecycle operator from local source"
header_text "[OPERATOR] Source: ${LOCAL_OPERATOR_PATH}"
header_text "[OPERATOR] Including all uncommitted changes"

cd "${LOCAL_OPERATOR_PATH}"

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