#!/usr/bin/env bash
set -euo pipefail

# Build the Docker image
# Usage: ./build.sh [image-name] [tag]
#
# NOTE: This is optional - the E2E test framework automatically builds
# and loads custom images when you run ./scripts/run-e2e.sh

IMAGE_NAME=${1:-"localhost/operator-features-validator"}
TAG=${2:-"local"}
FULL_IMAGE="${IMAGE_NAME}:${TAG}"

echo "Building image: ${FULL_IMAGE}"

docker build -t "${FULL_IMAGE}" .

echo "✓ Built ${FULL_IMAGE}"
echo ""
echo "To load into Kind:"
echo "  kind load docker-image ${FULL_IMAGE} --name kind"
echo ""
echo "Or just run the E2E tests (builds and loads automatically):"
echo "  ./scripts/run-e2e.sh"