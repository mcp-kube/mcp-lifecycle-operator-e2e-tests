# Update Operations Tests

This test suite validates that the MCP Lifecycle Operator correctly handles spec updates without causing unnecessary downtime or status flickers.

## What This Tests

### Covered Scenarios

1. **Replica Updates**
   - Scale up (1 → 3 replicas)
   - Scale down (3 → 1 replica)
   - Verifies: Ready status maintained, no unnecessary pod restarts

2. **Environment Variable Updates**
   - Changing env var values
   - Verifies: Pods restart to apply changes, Ready status maintained

3. **Resource Limit Updates**
   - Increasing CPU/memory limits
   - Verifies: Rolling update occurs, Ready status maintained

### Key Validations

For each update operation, the test verifies:

✅ **Generation tracking**: `metadata.generation` increments after update
✅ **Reconciliation**: `status.observedGeneration` catches up to `metadata.generation`
✅ **Ready status**: Should maintain `Ready=True` throughout update (or recover quickly)
✅ **Pod restarts**: Verifies pods restart when expected (env vars, resources) and don't restart when not expected (scaling)
✅ **Status transitions**: No unwanted flickers to `Ready=False` during update

## Test Structure

Each test case follows this pattern:

```typescript
{
  name: 'Update replicas (scale up)',
  description: 'Scaling from 1 to 3 replicas should maintain Ready status',
  initialManifest: { /* Initial MCPServer spec */ },
  update: {
    description: 'Scale to 3 replicas',
    patch: { spec: { runtime: { replicas: 3 } } },
  },
  expectedBehavior: {
    maintainsReady: true,      // Should Ready stay True?
    expectRestart: false,       // Should pods restart?
    expectedReadyReason: 'Available',
  },
}
```

## Running the Tests

### Standalone

```bash
# Run update operations tests only
DEBUG_YAML=1 OPERATOR_REF=refs/pull/75/head ./scripts/test-server.sh test-servers/update-operations
```

### As Part of Full Suite

```bash
# Run all E2E tests including update operations
OPERATOR_REF=refs/pull/75/head ./scripts/run-e2e.sh
```

## Expected Behavior

### Successful Update Flow

```
1. Deploy initial MCPServer → Ready=True
2. Apply spec update
3. metadata.generation increments (1 → 2)
4. Operator begins reconciliation
5. Pods restart (if needed for env vars/resources)
6. Rolling update completes
7. status.observedGeneration updates (1 → 2)
8. Ready=True maintained (or briefly Unknown, then True)
```

### Status Transitions (Good)

```
Ready: True (Available) - Initial state
Ready: True (Available) - During scale up
Ready: True (Available) - After scale completes
```

### Status Transitions (Bad - Should Not Happen)

```
Ready: True (Available) - Initial state
Ready: False (DeploymentUnavailable) - ❌ Unwanted flicker
Ready: True (Available) - After recovery
```

## Debug Mode

When `DEBUG_YAML=1`:

- Writes final MCPServer status to files
- Captures all status transitions
- Validates transitions using `ValidationRules.updateMaintainsReady()`
- Reports timing information (how long update took)

Example output:
```
[DEBUG_YAML] Output directory: logs/debug-yaml/update-operations-2026-04-09T12-00-00/
[DEBUG_YAML] Final status: update-replicas-final-status.yaml
[TRANSITION_VALIDATION] Validating update maintained Ready...
📊 Transition Validation Results:
   Transitions captured: 3
   Transitions expected: 1
   Total duration: 8.2s
   Slowest transition: Available → Available (4.1s)

✅ All validations passed!
```

## Test Cases

### 1. Update Replicas (Scale Up)
- Initial: 1 replica
- Update: 3 replicas
- Expected: No pod restarts, Ready maintained

### 2. Update Replicas (Scale Down)
- Initial: 3 replicas
- Update: 1 replica
- Expected: No pod restarts, Ready maintained

### 3. Update Environment Variables
- Initial: `TEST_VAR=initial-value`
- Update: `TEST_VAR=updated-value`
- Expected: Pods restart, Ready maintained during rolling update

### 4. Update Resource Limits
- Initial: 100m CPU, 64Mi memory
- Update: 200m CPU, 128Mi memory
- Expected: Pods restart, Ready maintained during rolling update

## Future Test Cases

See NEXT_STEPS.md for additional scenarios:

- Update container image (new version)
- Update port configuration
- Update path configuration
- Invalid updates (should reject gracefully)
- Concurrent updates
- Update during pod failure
- Update when scaled to zero

## Known Issues

None currently. See STATUS_FLICKERING_ANALYSIS.md for general operator issues.

## Related Documentation

- **NEXT_STEPS.md** - Future work and additional test coverage
- **STATUS_FLICKERING_ANALYSIS.md** - Known status transition issues
- **TEST_ANALYSIS_AND_SUGGESTIONS.md** - Comprehensive test analysis
