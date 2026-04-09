# Contributing to MCP E2E Tests

Thank you for your interest in contributing! This guide will help you add new tests and improve the testing framework.

## Table of Contents

- [Getting Started](#getting-started)
- [Adding New Tests](#adding-new-tests)
- [Test Types](#test-types)
- [Testing Best Practices](#testing-best-practices)
- [Validation Framework](#validation-framework)
- [Running and Debugging Tests](#running-and-debugging-tests)
- [Pull Request Process](#pull-request-process)

---

## Getting Started

### Prerequisites

Before contributing, ensure you have:

- Docker (for Kind)
- kubectl
- kind
- Node.js 20+
- npm
- jq (for JSON processing)
- git

### Setup

```bash
# Clone the repository
git clone https://github.com/mcp-kube/mcp-lifecycle-operator-e2e-tests.git
cd mcp-lifecycle-operator-e2e-tests

# Install framework dependencies
cd framework
npm install
cd ..

# Run tests to verify setup
OPERATOR_REF=refs/pull/75/head ./scripts/run-e2e.sh
```

---

## Adding New Tests

### Quick Start

1. **Choose test type**: Standalone or manifest-based
2. **Create test directory**
3. **Write test implementation**
4. **Add README documentation**
5. **Test locally**
6. **Submit PR**

### Detailed Steps

#### 1. Create Test Directory

```bash
mkdir -p test-servers/my-new-test
cd test-servers/my-new-test
```

#### 2. Write Test Implementation

Create `test.ts`:

```typescript
#!/usr/bin/env node
/**
 * E2E tests for [Feature Name]
 *
 * This test validates [what you're testing]
 */

import {
  TestFramework,
  K8sUtils,
  MCPClient,
  ValidationRules,
} from '../../framework/src/index.js';

async function main() {
  const framework = new TestFramework('my-new-test');
  const k8s = new K8sUtils();

  try {
    await framework.run(async (test) => {
      await test('my test case description', async () => {
        // Your test logic here
        const condition = await k8s.getMCPServerCondition(
          'server-name',
          'Ready',
          'default'
        );

        test.assertEqual(condition.status, 'True', 'Should be ready');
      });
    });
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }

  process.exit(framework.exitCode);
}

main();
```

Make it executable:

```bash
chmod +x test.ts
```

#### 3. Add README

Create `README.md`:

```markdown
# My New Test

Brief description of what this tests.

## What This Tests

- Feature 1
- Feature 2
- Feature 3

## Running

\`\`\`bash
./scripts/test-server.sh test-servers/my-new-test
\`\`\`

## Expected Behavior

Describe what should happen...
```

#### 4. Test Locally

```bash
# Run your test standalone
DEBUG_YAML=1 OPERATOR_REF=refs/pull/75/head \
  ./scripts/test-server.sh test-servers/my-new-test

# Run full suite to ensure no conflicts
OPERATOR_REF=refs/pull/75/head ./scripts/run-e2e.sh
```

---

## Test Types

### Standalone Tests

**Use when:** Testing error conditions, update operations, or scenarios without a persistent server

**Structure:**
```
test-servers/my-standalone-test/
├── test.ts          # Test implementation (manages own resources)
└── README.md        # Documentation
```

**Example:** `test-servers/error-conditions/`

**Implementation:**

```typescript
// Standalone tests create and cleanup their own resources
await test('my scenario', async () => {
  // Create MCPServer
  await execAsync('kubectl apply -f /tmp/my-manifest.yaml');

  // Wait for condition
  await k8s.waitForCondition('my-server', 'Ready', 'False', 'ConfigurationInvalid');

  // Assertions
  const condition = await k8s.getMCPServerCondition('my-server', 'Ready');
  test.assertEqual(condition.reason, 'ConfigurationInvalid');

  // Cleanup
  await execAsync('kubectl delete mcpserver my-server');
});
```

### Manifest-Based Tests

**Use when:** Testing functional features of a running MCP server

**Structure:**
```
test-servers/my-manifest-test/
├── manifest.yaml    # MCPServer definition
├── test.ts          # Test implementation (server pre-deployed)
└── README.md        # Documentation
```

**Example:** `test-servers/operator-features/`

**Implementation:**

```typescript
// Manifest-based tests assume server is already deployed
async function main() {
  const framework = new TestFramework('my-manifest-test');
  const client = new MCPClient('http://localhost:8080');

  await framework.run(async (test) => {
    await test('server responds', async () => {
      const result = await client.callTool('list_tools', {});
      test.assert(result.tools.length > 0, 'Should have tools');
    });
  });
}
```

---

## Testing Best Practices

### 1. Use Polling Instead of Fixed Sleeps

❌ **Bad:**
```typescript
await sleep(60 * 1000); // Fixed 60s wait
```

✅ **Good:**
```typescript
await k8s.waitForCondition(
  serverName,
  'Ready',
  'True',
  'Available',
  namespace,
  60 // Max 60s, exits early if condition met
);
```

### 2. Use ValidationRules for Common Patterns

❌ **Bad:**
```typescript
transitionValidation: {
  name: 'Happy path',
  expectedTransitions: [
    { conditionType: 'Ready', status: 'Unknown', reason: 'Initializing' },
    { conditionType: 'Ready', status: 'True', reason: 'Available' },
  ],
  ...TransitionValidator.noOptimisticLockFlickers(),
  allowExtraTransitions: true,
}
```

✅ **Good:**
```typescript
transitionValidation: ValidationRules.happyPath()
```

### 3. Always Clean Up Resources

✅ **Required:**
```typescript
try {
  // Test logic
  await execAsync('kubectl apply -f my-server.yaml');
  // ... test assertions ...
} finally {
  // Always cleanup, even on failure
  await execAsync('kubectl delete mcpserver my-server --ignore-not-found=true');
}
```

### 4. Use Descriptive Test Names

❌ **Bad:**
```typescript
await test('test 1', async () => { ... });
```

✅ **Good:**
```typescript
await test('MCPServer transitions from Initializing to Available', async () => { ... });
```

### 5. Add Helpful Console Output

✅ **Good:**
```typescript
console.log(`    Deploying ${serverName}...`);
console.log(`    Waiting for Ready status (timeout: 60s)...`);
console.log(`    Ready: status=${condition.status}, reason=${condition.reason}`);
```

### 6. Fail Fast with Meaningful Messages

✅ **Good:**
```typescript
test.assertEqual(
  condition.status,
  'True',
  `Expected Ready=True but got ${condition.status}. Message: ${condition.message}`
);
```

---

## Validation Framework

### Available ValidationRules

```typescript
// Happy path: Initializing → Available
ValidationRules.happyPath()

// Configuration errors
ValidationRules.configurationInvalid()

// Deployment failures
ValidationRules.imagePullBackOff()
ValidationRules.crashLoopBackOff()
ValidationRules.deploymentFailure('optional message substring')

// Scaling
ValidationRules.scaledToZero()

// Updates
ValidationRules.updateMaintainsReady('Available')

// Custom with baseline protection
ValidationRules.custom('My custom rule', [
  { conditionType: 'Ready', status: 'True', reason: 'MyReason' }
])
```

### Adding Timing Constraints

```typescript
transitionValidation: {
  ...ValidationRules.happyPath(),
  maxTotalDurationSec: 30,      // Fail if entire sequence > 30s
  maxTransitionDurationSec: 10, // Warn if any transition > 10s
}
```

### Custom Validation

```typescript
import { TransitionValidator } from '../../framework/src/index.js';

const customRule = {
  name: 'My custom validation',
  expectedTransitions: [
    {
      conditionType: 'Ready',
      status: 'True',
      reason: 'MyCustomReason',
      messageContains: 'expected text',
    },
  ],
  forbiddenTransitions: [
    {
      conditionType: 'Ready',
      status: 'False',
      reason: 'UnwantedReason',
    },
  ],
  allowExtraTransitions: true,
  maxTotalDurationSec: 60,
};

const result = TransitionValidator.validate(customRule, watchDir);
```

---

## Running and Debugging Tests

### Local Development

```bash
# Run single test with debug output
DEBUG_YAML=1 OPERATOR_REF=refs/pull/75/head \
  ./scripts/test-server.sh test-servers/my-test

# Run full suite
OPERATOR_REF=refs/pull/75/head ./scripts/run-e2e.sh

# Run with parallel execution (faster)
PARALLEL_TESTS=1 OPERATOR_REF=refs/pull/75/head ./scripts/run-e2e.sh
```

### Debug Mode

When `DEBUG_YAML=1`:

1. **Output files** created in `logs/debug-yaml/<test>-<timestamp>/`
2. **Input manifests** saved (e.g., `server-name-input.yaml`)
3. **Output status** saved (e.g., `server-name-output.yaml`)
4. **Transitions captured** in `status-transitions/` directory
5. **Validation results** printed to console

Example structure:
```
logs/debug-yaml/my-test-2026-04-09T12-00-00/
├── server-name-input.yaml
├── server-name-output.yaml
└── server-name-status-transitions/
    ├── status-transition-01-2026-04-09T12-00-01.yaml
    ├── status-transition-02-2026-04-09T12-00-03.yaml
    └── status-transition-03-2026-04-09T12-00-05.yaml
```

### Debugging Failed Tests

1. **Check DEBUG_YAML output**:
   ```bash
   cat logs/debug-yaml/my-test-*/server-name-output.yaml
   ```

2. **Review status transitions**:
   ```bash
   cat logs/debug-yaml/my-test-*/server-name-status-transitions/*.yaml
   ```

3. **Check operator logs**:
   ```bash
   kubectl logs -n mcp-lifecycle-operator-system \
     deployment/mcp-lifecycle-operator-controller-manager
   ```

4. **Inspect resources**:
   ```bash
   # Keep cluster after failure
   KEEP_CLUSTER=true KEEP_FAILED_SERVERS=true ./scripts/run-e2e.sh

   # Then inspect manually
   kubectl get mcpserver -A
   kubectl describe mcpserver my-server
   kubectl get pods -l mcp-server=my-server
   ```

---

## Pull Request Process

### Before Submitting

1. **Run tests locally**:
   ```bash
   OPERATOR_REF=refs/pull/75/head ./scripts/run-e2e.sh
   ```

2. **Add documentation**:
   - Test file comments
   - README.md in test directory
   - Update NEXT_STEPS.md if applicable

3. **Follow code style**:
   - Use TypeScript
   - Use existing patterns (see test-servers/error-conditions/)
   - Add helpful console output
   - Clean up resources in `finally` blocks

### Submitting

1. **Create feature branch**:
   ```bash
   git checkout -b add-my-test
   ```

2. **Commit with Co-Authored-By**:
   ```bash
   git commit -m "Add tests for [feature]

   [Detailed description]

   Co-Authored-By: Your Name <your.email@example.com>"
   ```

3. **Push and create PR**:
   ```bash
   git push origin add-my-test
   # Create PR on GitHub
   ```

### PR Checklist

- [ ] Tests pass locally
- [ ] Documentation added (README.md)
- [ ] Code follows existing patterns
- [ ] Resources cleaned up properly
- [ ] No hardcoded waits (use polling)
- [ ] Helpful console output added
- [ ] Commit includes Co-Authored-By

---

## Common Patterns

### Pattern 1: Test Configuration Error

```typescript
await test('missing secret causes ConfigurationInvalid', async () => {
  // Deploy MCPServer with non-existent secret
  await execAsync('kubectl apply -f invalid-manifest.yaml');

  // Wait for ConfigurationInvalid
  await k8s.waitForCondition(
    'my-server',
    'Ready',
    'False',
    'ConfigurationInvalid',
    namespace,
    10
  );

  // Verify Accepted=False
  const accepted = await k8s.getMCPServerCondition('my-server', 'Accepted');
  test.assertEqual(accepted.status, 'False');

  // Cleanup
  await execAsync('kubectl delete mcpserver my-server');
});
```

### Pattern 2: Test Happy Path

```typescript
await test('server deploys successfully', async () => {
  // Deploy
  await execAsync('kubectl apply -f valid-manifest.yaml');

  // Wait for Ready
  await k8s.waitForCondition('my-server', 'Ready', 'True', 'Available');

  // Verify observedGeneration
  const generation = await k8s.getMCPServerGeneration('my-server');
  const observedGen = await k8s.getMCPServerObservedGeneration('my-server');
  test.assertEqual(observedGen, generation);

  // Cleanup
  await execAsync('kubectl delete mcpserver my-server');
});
```

### Pattern 3: Test Update Operation

```typescript
await test('updating replicas maintains Ready status', async () => {
  // Initial deploy
  await execAsync('kubectl apply -f initial.yaml');
  await k8s.waitForCondition('my-server', 'Ready', 'True', 'Available');

  // Update
  await execAsync('kubectl patch mcpserver my-server --type=merge -p '{"spec":{"runtime":{"replicas":3}}}'');

  // Wait for reconciliation
  const newGen = await k8s.getMCPServerGeneration('my-server');
  await k8s.waitForPredicate(
    async () => {
      const obs = await k8s.getMCPServerObservedGeneration('my-server');
      return obs === newGen;
    },
    'observedGeneration to update'
  );

  // Verify still Ready
  const condition = await k8s.getMCPServerCondition('my-server', 'Ready');
  test.assertEqual(condition.status, 'True');

  // Cleanup
  await execAsync('kubectl delete mcpserver my-server');
});
```

---

## Questions?

- **File an issue**: https://github.com/mcp-kube/mcp-lifecycle-operator-e2e-tests/issues
- **Review examples**: Look at `test-servers/error-conditions/` and `test-servers/update-operations/`
- **Read documentation**: See NEXT_STEPS.md, TEST_ANALYSIS_AND_SUGGESTIONS.md

---

## Related Documentation

- **NEXT_STEPS.md** - Future work and missing coverage
- **README.md** - User documentation
- **TEST_ANALYSIS_AND_SUGGESTIONS.md** - Comprehensive analysis
- **STATUS_FLICKERING_ANALYSIS.md** - Known operator issues
