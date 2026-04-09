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

# Watch ALL mcpservers in the namespace (don't wait for it to exist)
# We'll filter for the specific server name in the processing loop
kubectl get mcpserver -n "${NAMESPACE}" --watch -o json 2>/dev/null | while read -r line; do
  # Skip empty lines
  if [ -z "$line" ]; then
    continue
  fi

  # Check if this is the resource we care about
  RESOURCE_NAME=$(echo "$line" | python3 -c "
import sys, json
try:
    obj = json.load(sys.stdin)
    print(obj.get('metadata', {}).get('name', ''))
except:
    pass
" 2>/dev/null || echo "")

  if [ "${RESOURCE_NAME}" != "${SERVER_NAME}" ]; then
    continue
  fi

  # Try to parse as JSON and extract status
  STATUS_JSON=$(echo "$line" | python3 -c "
import sys, json, hashlib
try:
    obj = json.load(sys.stdin)
    status = obj.get('status', {})
    if status:
        print(json.dumps(status, sort_keys=True, indent=2))
except:
    pass
" 2>/dev/null || echo "")

  if [ -z "${STATUS_JSON}" ]; then
    continue
  fi

  # Compute hash of status
  CURRENT_HASH=$(echo "${STATUS_JSON}" | shasum -a 256 | cut -d' ' -f1)

  # If status changed, save it
  if [ "${CURRENT_HASH}" != "${LAST_HASH}" ]; then
    SEQUENCE=$((SEQUENCE + 1))
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")

    # Extract condition info for logging
    READY_STATUS=$(echo "${STATUS_JSON}" | python3 -c "
import sys, json
try:
    status = json.load(sys.stdin)
    conditions = status.get('conditions', [])
    ready = next((c for c in conditions if c['type'] == 'Ready'), None)
    if ready:
        print(ready.get('status', 'Unknown'))
except:
    print('Unknown')
" 2>/dev/null || echo "Unknown")

    READY_REASON=$(echo "${STATUS_JSON}" | python3 -c "
import sys, json
try:
    status = json.load(sys.stdin)
    conditions = status.get('conditions', [])
    ready = next((c for c in conditions if c['type'] == 'Ready'), None)
    if ready:
        print(ready.get('reason', 'Unknown'))
except:
    print('Unknown')
" 2>/dev/null || echo "Unknown")

    # Save full resource as YAML
    OUTPUT_FILE="${OUTPUT_DIR}/status-transition-$(printf "%02d" ${SEQUENCE})-${TIMESTAMP}.yaml"

    # Convert JSON to YAML by re-fetching the resource (simpler than parsing)
    kubectl get mcpserver "${SERVER_NAME}" -n "${NAMESPACE}" -o yaml > "${OUTPUT_FILE}" 2>/dev/null || echo "$line" > "${OUTPUT_FILE}"

    if [ -s "${OUTPUT_FILE}" ]; then
      echo "[WATCH] Transition ${SEQUENCE}: Ready=${READY_STATUS}, reason=${READY_REASON}"
      LAST_HASH="${CURRENT_HASH}"
    else
      # Failed to save, decrement sequence
      SEQUENCE=$((SEQUENCE - 1))
    fi
  fi
done

echo "[WATCH] Watch ended for ${SERVER_NAME}"
