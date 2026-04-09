# Error Conditions Test Suite

This test suite validates error handling and status conditions introduced in PR #75 for the MCP Lifecycle Operator.

**Note:** This is a standalone test suite that manages its own resources. Unlike other tests that deploy a single MCPServer via `manifest.yaml`, this test deploys and cleans up multiple error scenarios independently.

## Overview

PR #75 introduces a Kubernetes-native condition-based status model with two primary conditions:

### Accepted Condition
Validates configuration before creating resources.

**Reasons:**
- `Valid` (Status=True) - Configuration is valid, all referenced resources exist
- `Invalid` (Status=False) - Configuration has errors (missing resources, invalid references)

### Ready Condition
Indicates overall server operational status.

**Reasons:**
- `Available` (Status=True) - Server is ready, at least one instance healthy
- `ConfigurationInvalid` (Status=False) - Accepted=False, cannot proceed
- `DeploymentUnavailable` (Status=False) - No healthy instances (ImagePullBackOff, CrashLoopBackOff, etc.)
- `ScaledToZero` (Status=True) - Deployment scaled to 0 replicas (following Kubernetes Deployment semantics)
- `Initializing` (Status=Unknown) - Waiting for initial deployment status

## Test Cases

### Configuration Validation (Accepted=False, Invalid)

1. **Missing Secret in storage** - Secret referenced in `spec.config.storage` does not exist
2. **Missing ConfigMap in storage** - ConfigMap referenced in `spec.config.storage` does not exist
3. **Missing Secret in envFrom** - Secret referenced in `spec.config.envFrom` does not exist
4. **Missing ConfigMap in envFrom** - ConfigMap referenced in `spec.config.envFrom` does not exist

### Deployment Availability (Ready=False, DeploymentUnavailable)

5. **ImagePullBackOff** - Non-existent image causes image pull failures
6. **CrashLoopBackOff** - Container crashes immediately on startup

### Scaling (Ready=True, ScaledToZero)

7. **ScaledToZero** - Deployment configured with 0 replicas (intentional, valid state following Kubernetes Deployment semantics)

**Note**: Individual `env` references (via `secretKeyRef` or `configMapKeyRef`) are not validated by the operator at the Accepted condition level. Kubernetes validates these at pod creation time, which would cause the Ready condition to become False with reason DeploymentUnavailable.

## Implementation Details

### Manifests
Each test case has a dedicated manifest file in `manifests/`:
- `01-missing-secret-storage.yaml`
- `02-missing-configmap-storage.yaml`
- `03-missing-secret-envfrom.yaml`
- `04-missing-configmap-envfrom.yaml`
- `05-image-pull-backoff.yaml`
- `06-crash-loop-backoff.yaml`
- `07-scaled-to-zero.yaml`

### Test Script
The `test.ts` script:
1. Deploys each manifest sequentially
2. Waits for conditions to stabilize (timing varies by scenario)
3. Verifies the expected Accepted and Ready condition statuses and reasons
4. Checks that observedGeneration is properly set
5. Cleans up the MCPServer resource

### Stabilization Times
Different error scenarios take different amounts of time to appear:
- **Configuration errors** (~5s) - Fast, validation happens immediately
- **Image pull errors** (~60s) - Slower, requires image pull attempts
- **Crash loop errors** (~30s) - Medium, requires multiple crash attempts
- **Scaled to zero** (~10s) - Fast, deployment reconciliation is quick

## Running the Tests

From the repository root:

```bash
# Run all E2E tests (includes error-conditions)
./scripts/run-e2e.sh

# Run only error-conditions tests
./scripts/test-server.sh test-servers/error-conditions

# Run with YAML debug output (shows input manifests and output status)
DEBUG_YAML=1 ./scripts/run-e2e.sh
```

### Debug YAML Output

Set `DEBUG_YAML=1` to capture detailed YAML for each test:
- **Input Manifest**: The MCPServer manifest being tested
- **Output Status**: The resulting status with conditions, observedGeneration, etc.
- **Status Transitions**: All status changes from creation to final state

Files are written to: `logs/debug-yaml/error-conditions-{timestamp}/`
- `{server-name}-input.yaml` - Input manifest for each error scenario
- `{server-name}-output.yaml` - Full MCPServer YAML with status
- `{server-name}-status-transitions/` - Directory containing all status transitions:
  - `status-transition-01-{timestamp}.yaml` - Initial state (often `Initializing`)
  - `status-transition-02-{timestamp}.yaml` - Next state
  - ... etc

This is useful for:
- Understanding exactly what's being tested
- **Capturing transient states** like `Initializing` that are hard to test directly
- Debugging condition transitions and timing
- Documenting operator behavior
- Comparing different test runs
- Creating documentation examples

## Expected Results

All 8 test cases (7 error scenarios + 1 placeholder) should pass, validating:
- ✅ Accepted condition status and reason are correct
- ✅ Ready condition status and reason are correct
- ✅ observedGeneration is properly tracked
- ✅ Condition messages contain helpful error details

## Notes

- No custom server image is required - tests use existing images or non-existent references
- Tests clean up after themselves by deleting MCPServer resources
- Some tests have longer stabilization times to allow errors to manifest
- The `Initializing` reason is transient and difficult to test reliably, so it's not included
