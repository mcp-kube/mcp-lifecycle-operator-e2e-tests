#!/usr/bin/env bash
# Watch MCPServer status transitions and save each unique state
# Usage: watch-status.sh <server-name> <namespace> <output-dir>

set -euo pipefail

SERVER_NAME="${1:-}"
NAMESPACE="${2:-default}"
OUTPUT_DIR="${3:-}"

if [ -z "${SERVER_NAME}" ] || [ -z "${OUTPUT_DIR}" ]; then
  echo "Usage: watch-status.sh <server-name> <namespace> <output-dir>"
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"

# Track the last status hash to detect changes
LAST_HASH=""
SEQUENCE=0

echo "[WATCH] Starting status watch for ${SERVER_NAME} in namespace ${NAMESPACE}"
echo "[WATCH] Output directory: ${OUTPUT_DIR}"

# Watch the resource and process each change
kubectl get mcpserver "${SERVER_NAME}" -n "${NAMESPACE}" --watch -o yaml 2>/dev/null | while IFS= read -r line; do
  # Accumulate lines until we get a complete resource
  if [ -z "${YAML_BUFFER:-}" ]; then
    YAML_BUFFER="$line"
  else
    YAML_BUFFER="${YAML_BUFFER}"$'\n'"${line}"
  fi

  # Check if we have a complete YAML document (ends with a line that's just "---" or starts with "---")
  if echo "$line" | grep -q "^---"; then
    # We have a complete document, process it
    if [ -n "${YAML_BUFFER}" ]; then
      # Extract just the status section and compute hash
      STATUS_SECTION=$(echo "${YAML_BUFFER}" | sed -n '/^status:/,/^[a-z]/p' | head -n -1)

      if [ -n "${STATUS_SECTION}" ]; then
        CURRENT_HASH=$(echo "${STATUS_SECTION}" | shasum -a 256 | cut -d' ' -f1)

        # If status changed, save it
        if [ "${CURRENT_HASH}" != "${LAST_HASH}" ]; then
          SEQUENCE=$((SEQUENCE + 1))
          TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")

          # Extract condition info for logging
          READY_STATUS=$(echo "${STATUS_SECTION}" | grep -A 3 "type: Ready" | grep "status:" | awk '{print $2}' | tr -d '"' || echo "Unknown")
          READY_REASON=$(echo "${STATUS_SECTION}" | grep -A 3 "type: Ready" | grep "reason:" | awk '{print $2}' || echo "Unknown")

          OUTPUT_FILE="${OUTPUT_DIR}/status-transition-${SEQUENCE}-${TIMESTAMP}.yaml"
          echo "${YAML_BUFFER}" > "${OUTPUT_FILE}"
          echo "[WATCH] Transition ${SEQUENCE}: Ready=${READY_STATUS}, reason=${READY_REASON} → ${OUTPUT_FILE}"

          LAST_HASH="${CURRENT_HASH}"
        fi
      fi
    fi

    # Reset buffer for next document
    YAML_BUFFER=""
  fi
done

echo "[WATCH] Watch ended for ${SERVER_NAME}"
