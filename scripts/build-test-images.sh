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

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

header_text "[BUILD] Building and loading custom MCP server images..."

# Find all test server directories with a server/ subdirectory
BUILT_IMAGES=0

for test_server_dir in "${PROJECT_ROOT}"/test-servers/*/; do
  test_server_name=$(basename "${test_server_dir}")

  # Skip template directory
  if [ "${test_server_name}" = "template" ]; then
    continue
  fi

  # Check if there's a server subdirectory
  server_dir="${test_server_dir}/server"
  if [ ! -d "${server_dir}" ]; then
    continue
  fi

  # Check if there's a Dockerfile
  if [ ! -f "${server_dir}/Dockerfile" ]; then
    echo "[BUILD] Skipping ${test_server_name} - no Dockerfile found"
    continue
  fi

  # Read image name from manifest.yaml if it exists
  manifest="${test_server_dir}/manifest.yaml"
  if [ -f "${manifest}" ]; then
    # Extract image ref from manifest
    IMAGE_REF=$(grep -A 2 "containerImage:" "${manifest}" | grep "ref:" | awk '{print $2}' || echo "")

    if [ -z "${IMAGE_REF}" ]; then
      echo "[BUILD] Warning: Could not extract image ref from ${manifest}, skipping"
      continue
    fi

    header_text "[BUILD] Building ${test_server_name} (${IMAGE_REF})..."

    # Build the image
    (cd "${server_dir}" && docker build -t "${IMAGE_REF}" . --quiet)
    success_text "[BUILD] ✓ Built ${IMAGE_REF}"

    # Load into Kind cluster
    header_text "[BUILD] Loading ${IMAGE_REF} into Kind cluster..."
    kind load docker-image "${IMAGE_REF}" --name "${KIND_CLUSTER_NAME}"
    success_text "[BUILD] ✓ Loaded ${IMAGE_REF} into cluster"

    BUILT_IMAGES=$((BUILT_IMAGES + 1))
  else
    echo "[BUILD] Warning: No manifest.yaml found for ${test_server_name}, skipping"
  fi
done

if [ "${BUILT_IMAGES}" -eq 0 ]; then
  echo "[BUILD] No custom images to build"
else
  success_text "[BUILD] ✓ Built and loaded ${BUILT_IMAGES} custom image(s)"
fi
