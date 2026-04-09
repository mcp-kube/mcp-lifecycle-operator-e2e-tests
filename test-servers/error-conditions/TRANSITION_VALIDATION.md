# Status Transition Validation

This directory includes automated validation of status transitions to ensure:
1. No unwanted transient failures (e.g., optimistic lock conflicts)
2. Status transitions follow expected patterns
3. Final states are correct

## How It Works

When `DEBUG_YAML=1`, the test framework:
1. Starts a `StatusWatcher` before deploying resources
2. Captures all status updates to YAML files
3. Validates transitions against expected patterns
4. Fails the test if forbidden transitions appear

## Example: ScaledToZero Test

```typescript
{
  name: 'ScaledToZero',
  // ... other test config ...
  transitionValidation: {
    name: 'ScaledToZero should not flicker',
    expectedTransitions: [
      {
        conditionType: 'Ready',
        status: 'True',
        reason: 'ScaledToZero',
        messageContains: 'scaled to 0 replicas',
      },
    ],
    // Forbid optimistic lock conflict flickers
    forbiddenTransitions: [
      {
        conditionType: 'Ready',
        status: 'False',
        reason: 'DeploymentUnavailable',
        messageContains: 'object has been modified',
      },
    ],
    allowExtraTransitions: true,
  },
}
```

## Current Status (Before Operator Fix)

**Expected Behavior** (after operator fix):
```
Transition 1: Ready=True, reason=ScaledToZero ✅
```

**Actual Behavior** (current):
```
Transition 1: Ready=True, reason=ScaledToZero ✅
Transition 2: Ready=False, reason=DeploymentUnavailable ❌ FLICKER
Transition 3: Ready=True, reason=ScaledToZero ✅
```

The transition validation **currently fails** for ScaledToZero because it detects the optimistic lock flicker. This is **intentional** - the test documents the problem and will pass once the operator is fixed per `STATUS_FLICKERING_ANALYSIS.md`.

## Validation Rules

### Common Patterns

#### 1. No Optimistic Lock Flickers

```typescript
...TransitionValidator.noOptimisticLockFlickers()
```

This adds forbidden transitions:
- `Ready=False, DeploymentUnavailable` with message containing "object has been modified"
- `Ready=False, DeploymentUnavailable` with message containing "Operation cannot be fulfilled"

#### 2. Exact Transition Count

```typescript
{
  expectedTransitions: [...],
  allowExtraTransitions: false, // Must be exactly N transitions
}
```

#### 3. Final State Only

```typescript
{
  expectedTransitions: [
    // Only validate the final state
    { conditionType: 'Ready', status: 'True', reason: 'Available' }
  ],
  allowExtraTransitions: true, // Ignore intermediate states
}
```

## Test Scenarios

### Configuration Errors (Immediate, Single Transition)

```typescript
transitionValidation: {
  expectedTransitions: [{
    conditionType: 'Ready',
    status: 'False',
    reason: 'ConfigurationInvalid',
  }],
  ...TransitionValidator.noOptimisticLockFlickers(),
  allowExtraTransitions: false, // Expect exactly 1
}
```

### Deployment Errors (Multiple Transitions Allowed)

```typescript
transitionValidation: {
  expectedTransitions: [{
    conditionType: 'Ready',
    status: 'False',
    reason: 'DeploymentUnavailable',
    messageNotContains: 'object has been modified', // Not conflict
  }],
  ...TransitionValidator.noOptimisticLockFlickers(),
  allowExtraTransitions: true, // May have multiple as deployment stabilizes
}
```

## Running Tests

```bash
# Run with transition validation
DEBUG_YAML=1 ./scripts/run-e2e.sh

# Or just error-conditions tests
DEBUG_YAML=1 ./scripts/test-server.sh test-servers/error-conditions
```

## Output

When validation runs, you'll see:

```
[TRANSITION_VALIDATION] Validating transitions...
📊 Transition Validation Results:
   Transitions captured: 3
   Transitions expected: 1

❌ FAILED with 1 error(s):
   ❌ FORBIDDEN transition found in sequence 2: Ready=False, reason=DeploymentUnavailable,
      message contains "object has been modified"
      Actual message: "Failed to reconcile Deployment: Operation cannot be fulfilled..."
```

Or on success:

```
[TRANSITION_VALIDATION] Validating transitions...
📊 Transition Validation Results:
   Transitions captured: 1
   Transitions expected: 1

✅ All validations passed!
```

## Adding Validation to New Tests

1. Import the validator:
```typescript
import { TransitionValidator, type TransitionValidationRule } from '../../framework/src/index.js';
```

2. Add to test case:
```typescript
{
  name: 'My Test',
  // ... other config ...
  transitionValidation: {
    name: 'My validation description',
    expectedTransitions: [
      { conditionType: 'Ready', status: 'True', reason: 'Available' }
    ],
    ...TransitionValidator.noOptimisticLockFlickers(),
  },
}
```

3. Run with `DEBUG_YAML=1`

## Validation Result Files

When `DEBUG_YAML=1`, transition files are saved to:
```
logs/debug-yaml/error-conditions-{timestamp}/{scenario}-status-transitions/
  status-transition-01-{timestamp}.yaml
  status-transition-02-{timestamp}.yaml
  ...
```

These files are:
- Loaded by `TransitionValidator.loadTransitions()`
- Analyzed against expected/forbidden patterns
- Used to generate validation reports

## Related Documentation

- `STATUS_FLICKERING_ANALYSIS.md` - Root cause analysis and proposed fixes
- `test-servers/error-conditions/README.md` - Test suite overview
- `framework/src/transition-validator.ts` - Validator implementation
