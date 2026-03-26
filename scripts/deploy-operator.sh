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
KIND_CLUSTER_NAME=${KIND_CLUSTER_NAME:-"kind"}
OPERATOR_IMAGE=${OPERATOR_IMAGE:-"mcp-operator:test"}

header_text "[OPERATOR] Building and deploying MCP lifecycle operator from source (ref: ${OPERATOR_REF})"

# Create temporary directory for operator build
OPERATOR_DIR=$(mktemp -d)
trap "rm -rf ${OPERATOR_DIR}" EXIT

header_text "[OPERATOR] Cloning operator repository..."
git clone --quiet https://github.com/kubernetes-sigs/mcp-lifecycle-operator "${OPERATOR_DIR}"
cd "${OPERATOR_DIR}"

header_text "[OPERATOR] Checking out ref: ${OPERATOR_REF}"
git checkout --quiet "${OPERATOR_REF}"

header_text "[OPERATOR] Building operator Docker image..."
make docker-build IMG="${OPERATOR_IMAGE}"

header_text "[OPERATOR] Loading image into Kind cluster..."
# Save image to tar and load into kind (more reliable in CI)
docker save "${OPERATOR_IMAGE}" -o /tmp/operator-image.tar
kind load image-archive /tmp/operator-image.tar --name "${KIND_CLUSTER_NAME}"
rm -f /tmp/operator-image.tar

header_text "[OPERATOR] Deploying operator to cluster..."
make deploy IMG="${OPERATOR_IMAGE}"

header_text "[OPERATOR] Waiting for operator to be ready..."
kubectl wait --for=condition=Available deployment/mcp-lifecycle-operator-controller-manager \
  -n mcp-lifecycle-operator-system --timeout=300s

success_text "[OPERATOR] ✓ Operator deployed and ready"
