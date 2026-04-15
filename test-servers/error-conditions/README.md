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

12. **Optional ConfigMap in storage** - Deploy with missing but optional ConfigMap ⚠️ **Kubernetes Limitation**
   - ConfigMap does not exist but has `optional: true` flag
   - Expected: `Accepted=True, Valid` (operator correctly skips validation for optional resources)
   - Expected: `Ready=False, DeploymentUnavailable` (pods cannot start - Kubernetes limitation)
   - **Note**: Kubernetes does NOT support `optional: true` for volume mounts, only for env references
   - Validates: Operator correctly accepts optional storage configuration (even though Kubernetes can't mount it)

13. **Optional Secret in storage** - Deploy with missing but optional Secret ⚠️ **Kubernetes Limitation**
   - Secret does not exist but has `optional: true` flag
   - Expected: `Accepted=True, Valid` (operator correctly skips validation for optional resources)
   - Expected: `Ready=False, DeploymentUnavailable` (pods cannot start - Kubernetes limitation)
   - **Note**: Kubernetes does NOT support `optional: true` for volume mounts, only for env references
   - Validates: Operator correctly accepts optional storage configuration (even though Kubernetes can't mount it)

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

19. **lastTransitionTime updates on status change (recovery)** - Verify lastTransitionTime DOES change when status changes
   - Deploy MCPServer with missing ConfigMap (Accepted=False, Invalid)
   - Capture lastTransitionTime (T1)
   - Add 2-second sleep to ensure different timestamp
   - Create the missing ConfigMap to fix the error
   - Expected: `Accepted=True, Valid` (status changed from False to True)
   - Expected: lastTransitionTime = T2 where T2 > T1
   - Expected: `Ready=True, Available` eventually
   - Validates: Kubernetes condition contract - lastTransitionTime updates when status changes
   - Validates: Operator correctly updates lastTransitionTime during recovery

### Deployment Recovery (Ready → Available transitions)

20. **Recovery: Fix bad image** - Deploy with non-existent image, then fix it and verify recovery
   - Initial state: Bad image causes ImagePullBackOff
   - Expected: `Accepted=True, Valid` (config is valid, just bad image)
   - Expected: `Ready=False, DeploymentUnavailable` (pods can't start)
   - Update image to valid reference
   - Verify: generation increments, observedGeneration advances
   - Expected: `Ready=True, Available` (deployment rolling update succeeds)
   - Expected: Pods running with new image
   - Validates: Operator recovers from DeploymentUnavailable when image is fixed
   - Validates: Deployment rolling update works correctly

### Condition Metadata Consistency

21. **Condition observedGeneration consistency** - Verify all conditions have matching observedGeneration
   - Deploy MCPServer and wait for Ready=True, Available
   - Verify: `status.observedGeneration` = `Accepted.observedGeneration` = `Ready.observedGeneration`
   - Perform spec update (scale to 2 replicas)
   - Wait for observedGeneration to advance
   - Verify: All observedGenerations still match after update
   - Validates: Condition metadata correctness across reconciliation cycles
   - Validates: All conditions refer to the same generation
   - Ensures: No bugs in condition update logic that could cause observedGeneration inconsistency

### Transient State Observation (Best Effort)

22. **Initializing state capture** - Try to observe Ready=Unknown, Initializing during deployment (best effort)
   - Deploy MCPServer and poll status every 100ms (rapid polling)
   - Try to capture: `Ready=Unknown, reason=Initializing` (transient state)
   - Expected: May or may not observe Initializing (timing dependent)
   - Eventually: `Ready=True, Available` (final state)
   - Test always passes: This is best-effort observation only
   - Validates: Operator sets Initializing when appropriate (if captured)
   - Documents: Transient state behavior for debugging timing issues
   - Note: Initializing is very fast and difficult to capture reliably

### Ownership Validation (PR #91)

**Note**: Ownership validation happens during **reconciliation**, not spec validation. This means:
- `Accepted=True, Valid` (spec is valid - ConfigMaps/Secrets exist)
- `Ready=False, DeploymentUnavailable` or `Ready=False, ServiceUnavailable` (reconciliation failed due to ownership conflict)
- Error message in `Ready.message` explains the ownership issue

23. **Reject foreign-owned Deployment** - Prevent controller wars by rejecting resources owned by other controllers
   - Pre-create Deployment with ownerReference to a different controller
   - Try to create MCPServer with same name
   - Expected: `Accepted=True, Valid` (spec is valid)
   - Expected: `Ready=False, DeploymentUnavailable` (reconciliation failed)
   - Expected: Ready message mentions ownership conflict ("is owned by", "cannot be managed")
   - Expected: Deployment remains unchanged (not modified by MCPServer controller)
   - Validates: Operator respects existing controller ownership
   - Validates: Prevents silent overwrites of foreign-owned resources
   - Validates: Correct status reporting (ownership errors in Ready, not Accepted)
   - Introduced in PR #91 to fix issue #85

24. **Reject unowned Deployment/Service** - Prevent silent adoption of manually-created resources
   - Pre-create Deployment and Service with no ownerReferences
   - Try to create MCPServer with same name
   - Expected: `Accepted=True, Valid` (spec is valid)
   - Expected: `Ready=False, DeploymentUnavailable` (reconciliation failed)
   - Expected: Ready message mentions missing owner ("has no controller owner")
   - Expected: Deployment and Service remain unchanged (no ownerReferences added)
   - Validates: Operator requires explicit ownership before managing resources
   - Validates: User must delete existing resources or choose different name
   - Validates: Correct status reporting (ownership errors in Ready, not Accepted)
   - Introduced in PR #91 to fix issue #85

### ConfigMap/Secret Watch Behavior (PR #93)

**Note**: PR #93 adds ConfigMap/Secret watches that trigger automatic reconciliation when these resources are created, updated, or deleted. Reconciliation is triggered by the watch, not by spec updates, so `metadata.generation` does NOT change.

25. **ConfigMap update watch** - ConfigMap content update triggers reconciliation but Deployment does NOT update
   - Create MCPServer with ConfigMap mounted as volume
   - Wait for Ready=True, Available
   - Capture initial generation and Deployment resourceVersion
   - Update ConfigMap content (change data)
   - Expected: Reconciliation triggered by ConfigMap watch (no spec update needed)
   - Expected: `Accepted=True, Valid` (validation passes - ConfigMap still exists)
   - Expected: Generation unchanged (watch-triggered, not spec-update-triggered)
   - Expected: Deployment resourceVersion unchanged (PodSpec unchanged)
   - Why: Pods reference ConfigMaps by name, not content (standard K8s behavior)
   - Validates: ConfigMap watch triggers reconciliation
   - Validates: No Deployment update for content-only changes (standard K8s semantics)
   - Introduced in PR #93 to solve issue #92

26. **ConfigMap deletion watch** - ConfigMap deletion triggers error state and auto-recovery on recreation
   - Create MCPServer with ConfigMap
   - Wait for Ready=True, Available
   - Capture initial generation
   - Delete ConfigMap
   - Expected: Reconciliation triggered by ConfigMap watch
   - Expected: `Accepted=False, Invalid` (validation fails - ConfigMap missing)
   - Expected: Generation unchanged (watch-triggered)
   - Expected: Deployment/Pods still exist (no cascade delete - standard K8s behavior)
   - Recreate ConfigMap
   - Expected: Auto-recovery via ConfigMap watch (no spec update needed)
   - Expected: `Accepted=True, Valid` → `Ready=True, Available`
   - Expected: Generation still unchanged (all watch-triggered)
   - Validates: ConfigMap deletion detection
   - Validates: Auto-recovery on ConfigMap recreation
   - Validates: Standard K8s behavior (no cascade delete)
   - Introduced in PR #93 to solve issue #92

27. **Multiple MCPServers same ConfigMap** - Field indexing handles multiple watchers correctly
   - Create 3 MCPServers all referencing same missing ConfigMap
   - All 3 should be in error state (Accepted=False, Invalid)
   - Capture initial generations for all 3
   - Create the shared ConfigMap once
   - Expected: All 3 MCPServers auto-recover (Accepted=True → Ready=True)
   - Expected: Generation unchanged for all 3 (all watch-triggered)
   - Expected: All 3 Deployments running
   - Validates: Field indexing correctly tracks multiple watchers
   - Validates: Single ConfigMap event triggers reconciliation for all referencing MCPServers
   - Validates: PR #93's `extractConfigMapNames` field indexer works correctly
   - Introduced in PR #93 to solve issue #92

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
- `19-foreign-owned-deployment.yaml`
- `20-unowned-resources.yaml`
- `20-lasttransitiontime-recovery.yaml` (legacy numbering)
- `21-recovery-bad-image.yaml` (legacy numbering)
- `22-configmap-update-watch.yaml`
- `23-configmap-delete-watch.yaml`
- `24-multiple-servers-same-configmap.yaml`
- `23-observedgeneration-consistency.yaml`
- `24-initializing-state-capture.yaml`

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

All 22 test cases should pass, validating:
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
