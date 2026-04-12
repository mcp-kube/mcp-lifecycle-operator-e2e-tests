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
- `ServiceUnavailable` (Status=False) - Service reconciliation failed (tested in operator unit tests)
- `ScaledToZero` (Status=True) - Deployment scaled to 0 replicas (following Kubernetes Deployment semantics)
- `Initializing` (Status=Unknown) - Waiting for initial deployment status

## Test Cases

### Configuration Validation (Accepted=False, Invalid)

1. **Missing Secret in storage** - Secret referenced in `spec.config.storage` does not exist
2. **Missing ConfigMap in storage** - ConfigMap referenced in `spec.config.storage` does not exist
3. **Missing Secret in envFrom** - Secret referenced in `spec.config.envFrom` does not exist
4. **Missing ConfigMap in envFrom** - ConfigMap referenced in `spec.config.envFrom` does not exist
5. **Empty ConfigMap name in storage** - ConfigMap name in storage mount is empty
6. **Empty Secret name in storage** - Secret name in storage mount is empty

**Note:** Empty ContainerImage ref is validated at the CRD/API level (OpenAPI schema), not in the operator controller, so it's rejected before reaching reconciliation.

### Deployment Availability (Ready=False, DeploymentUnavailable)

7. **ImagePullBackOff** - Non-existent image causes image pull failures
8. **CrashLoopBackOff** - Container crashes immediately on startup

### Scaling (Ready=True, ScaledToZero)

9. **ScaledToZero** - Deployment configured with 0 replicas (intentional, valid state following Kubernetes Deployment semantics)

### Recovery Scenarios (Error → Success transitions)

10. **Recovery: Fix missing ConfigMap** - Deploy with missing ConfigMap reference, then create the ConfigMap and verify recovery
   - Initial state: `Accepted=False, Invalid` → `Ready=False, ConfigurationInvalid`
   - Create missing ConfigMap during test
   - Verify: `Accepted=True, Valid` → `Ready=True, Available`
   - Validates: lastTransitionTime updates, observedGeneration advances, operator properly recovers from errors

11. **Recovery: Fix missing Secret** - Deploy with missing Secret reference, then create the Secret and verify recovery
   - Initial state: `Accepted=False, Invalid` → `Ready=False, ConfigurationInvalid`
   - Create missing Secret during test
   - Verify: `Accepted=True, Valid` → `Ready=True, Available`
   - Validates: lastTransitionTime updates, observedGeneration advances, Deployment and Pods successfully start

### Optional Resources (optional: true flag)

12. **Optional ConfigMap in storage** - Deploy with missing but optional ConfigMap
   - ConfigMap does not exist but has `optional: true` flag
   - Expected: `Accepted=True, Valid` (operator skips validation for optional resources)
   - Expected: `Ready=True, Available` (pods start successfully)
   - Validates: Operator respects optional flag in storage mounts

13. **Optional Secret in storage** - Deploy with missing but optional Secret
   - Secret does not exist but has `optional: true` flag
   - Expected: `Accepted=True, Valid` (operator skips validation for optional resources)
   - Expected: `Ready=True, Available` (pods start successfully)
   - Validates: Operator respects optional flag in storage mounts

14. **Optional ConfigMap in envFrom** - Deploy with missing but optional ConfigMap in envFrom
   - ConfigMap does not exist but has `optional: true` flag
   - Expected: `Accepted=True, Valid` (operator skips validation for optional resources)
   - Expected: `Ready=True, Available` (environment variables not set, no error)
   - Validates: Operator respects optional flag in envFrom

15. **Optional Secret in envFrom** - Deploy with missing but optional Secret in envFrom
   - Secret does not exist but has `optional: true` flag
   - Expected: `Accepted=True, Valid` (operator skips validation for optional resources)
   - Expected: `Ready=True, Available` (environment variables not set, no error)
   - Validates: Operator respects optional flag in envFrom

**Note**: Individual `env` references (via `secretKeyRef` or `configMapKeyRef`) are not validated by the operator at the Accepted condition level. Kubernetes validates these at pod creation time, which would cause the Ready condition to become False with reason DeploymentUnavailable.

### Stress Testing (Reconciliation Queue)

16. **Rapid successive updates** - Apply multiple spec updates rapidly and verify reconciliation handles them correctly
   - Deploy MCPServer with replicas=1
   - Apply 4 rapid updates: replicas=2, replicas=3, add env var, replicas=1
   - Expected: observedGeneration eventually reaches final generation (5)
   - Expected: Final state reflects all updates (replicas=1, env var present)
   - Expected: `Ready=True, Available` maintained throughout (or brief transitions)
   - Validates: Reconciliation queue handles rapid updates without missing changes
   - Validates: observedGeneration tracking works correctly under stress

17. **Update while deployment unavailable** - Apply spec updates while deployment is in error state
   - Deploy MCPServer with bad image (causes ImagePullBackOff)
   - Wait for `Accepted=True, Valid` and `Ready=False, DeploymentUnavailable`
   - Update replicas while deployment is unavailable (generation → 2)
   - Expected: observedGeneration advances to 2 (reconciliation continues)
   - Expected: `Ready=False, DeploymentUnavailable` (stays unavailable)
   - Expected: Deployment spec reflects new replica count
   - Validates: Operator continues reconciling spec changes even when deployment is unavailable
   - Validates: observedGeneration tracking works during error states

### Condition Lifecycle (lastTransitionTime Behavior)

18. **lastTransitionTime stability on generation change** - Verify lastTransitionTime doesn't change when only generation changes
   - Deploy MCPServer with port=8080
   - Wait for `Ready=True, Available` and capture lastTransitionTime (T1)
   - Update service port to 9090 (doesn't affect deployment health)
   - Expected: observedGeneration advances to 2
   - Expected: `Ready=True, Available` (unchanged)
   - Expected: lastTransitionTime = T1 (unchanged!)
   - Validates: Kubernetes condition contract - lastTransitionTime only changes when status/reason changes
   - Validates: Operator respects condition lifecycle semantics

19. **lastTransitionTime updates on reason change** - Verify lastTransitionTime DOES change when reason changes
   - Deploy MCPServer with replicas=1
   - Wait for `Ready=True, Available` and capture lastTransitionTime (T1)
   - Scale to 0 replicas (Ready status stays True, but reason changes)
   - Expected: `Ready=True, ScaledToZero` (reason changed from Available)
   - Expected: lastTransitionTime = T2 where T2 > T1
   - Validates: Kubernetes condition contract - lastTransitionTime updates when reason changes
   - Validates: Operator correctly updates lastTransitionTime on reason transitions

20. **lastTransitionTime updates on status change (recovery)** - Verify lastTransitionTime DOES change when status changes
   - Deploy MCPServer with missing ConfigMap (Accepted=False, Invalid)
   - Capture lastTransitionTime (T1)
   - Add 2-second sleep to ensure different timestamp
   - Create the missing ConfigMap to fix the error
   - Expected: `Accepted=True, Valid` (status changed from False to True)
   - Expected: lastTransitionTime = T2 where T2 > T1
   - Expected: `Ready=True, Available` eventually
   - Validates: Kubernetes condition contract - lastTransitionTime updates when status changes
   - Validates: Operator correctly updates lastTransitionTime during recovery

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
- `08-empty-configmap-name-storage.yaml`
- `09-empty-secret-name-storage.yaml`
- `10-recovery-missing-configmap.yaml`
- `11-recovery-missing-secret.yaml`
- `12-optional-configmap-storage.yaml`
- `13-optional-secret-storage.yaml`
- `14-optional-configmap-envfrom.yaml`
- `15-optional-secret-envfrom.yaml`
- `16-rapid-updates.yaml`
- `17-update-while-unavailable.yaml`
- `18-lasttransitiontime-stability.yaml`
- `19-lasttransitiontime-reason-change.yaml`
- `20-lasttransitiontime-recovery.yaml`

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

All 20 test cases should pass, validating:
- ✅ Accepted condition status and reason are correct
- ✅ Ready condition status and reason are correct
- ✅ observedGeneration is properly tracked
- ✅ Condition messages contain helpful error details

## Notes

- No custom server image is required - tests use existing images or non-existent references
- Tests clean up after themselves by deleting MCPServer resources
- Some tests have longer stabilization times to allow errors to manifest
- The `Initializing` reason is transient and difficult to test reliably, so it's not included
- **`ServiceUnavailable`** is tested in operator unit tests (`internal/controller/mcpserver_controller_test.go`) rather than E2E tests. Simulating Service reconciliation failures requires API client interceptors, which are not feasible in real cluster environments.
