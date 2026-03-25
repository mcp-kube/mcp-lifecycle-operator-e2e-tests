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
KIND_CLUSTER_NAME=${KIND_CLUSTER_NAME:-"kind"}

header_text "[CLEANUP] Deleting Kind cluster: ${KIND_CLUSTER_NAME}"

# Delete the Kind cluster
if kind delete cluster --name "${KIND_CLUSTER_NAME}" 2>/dev/null; then
  success_text "[CLEANUP] ✓ Cluster deleted successfully"
else
  echo "[CLEANUP] Cluster does not exist or already deleted"
fi

# Clean up any remaining Docker containers related to the cluster
CONTAINERS=$(docker ps -a --filter "label=io.x-k8s.kind.cluster=${KIND_CLUSTER_NAME}" -q 2>/dev/null || true)
if [ -n "${CONTAINERS}" ]; then
  header_text "[CLEANUP] Removing leftover containers..."
  docker rm -f ${CONTAINERS} 2>/dev/null || true
fi

success_text "[CLEANUP] ✓ Cleanup complete"
