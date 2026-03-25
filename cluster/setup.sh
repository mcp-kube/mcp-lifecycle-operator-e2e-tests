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

KIND_CLUSTER_NAME=${KIND_CLUSTER_NAME:-"kind"}
CI=${CI:-false}  # GitHub Actions sets CI=true automatically

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if cluster already exists
if kind get clusters 2>/dev/null | grep -q "^${KIND_CLUSTER_NAME}$"; then
  header_text "[SETUP] Cluster '${KIND_CLUSTER_NAME}' already exists"

  # In CI, delete without asking
  if [ "${CI}" = "true" ]; then
    header_text "[SETUP] Running in CI - deleting existing cluster..."
    kind delete cluster --name "${KIND_CLUSTER_NAME}"
  else
    # Interactive prompt for local development
    echo -n "Delete and recreate? (y/N): "
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
      header_text "[SETUP] Deleting existing cluster..."
      kind delete cluster --name "${KIND_CLUSTER_NAME}"
    else
      header_text "[SETUP] Using existing cluster"
      # Verify cluster is ready
      kubectl wait --for=condition=Ready nodes --all --timeout=60s
      success_text "[SETUP] ✓ Existing cluster is ready"
      exit 0
    fi
  fi
fi

# Create Kind cluster
header_text "[SETUP] Creating Kind cluster: ${KIND_CLUSTER_NAME}"
kind create cluster --config "${SCRIPT_DIR}/kind-config.yaml" --name "${KIND_CLUSTER_NAME}"

# Wait for cluster to be ready
header_text "[SETUP] Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=300s

success_text "[SETUP] ✓ Kind cluster created and ready"
