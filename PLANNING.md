# MCP Server E2E Testing Framework - Planning Document

## Overview

Automated end-to-end testing framework for MCP (Model Context Protocol) server images deployed via the Kubernetes MCP lifecycle operator.

## Architecture

### Components

1. **Cluster Management**
   - Kind (Kubernetes in Docker) cluster lifecycle
   - Automated setup and teardown
   - Network configuration for local development

2. **Operator Deployment**
   - Support for prebuilt operator images with manifests
   - Support for building operator from source (branch/tag/commit)
   - Version flexibility for testing against different operator versions

3. **MCP Server Deployment**
   - Deploy test MCP servers using operator CRDs
   - Configurable server images and configurations
   - Health check and readiness validation

4. **Test Execution**
   - TypeScript-based test programs
   - Direct MCP server communication (no LLM intermediary)
   - Test result collection and reporting

5. **Output & Reporting**
   - Test results (pass/fail)
   - Server logs on failure
   - Performance metrics (optional)
   - CI/CD integration support

## Directory Structure

```
mcp-lifecycle-operator-e2e-tests/
├── cluster/
│   ├── kind-config.yaml          # Kind cluster configuration
│   └── setup.sh                  # Cluster setup script
├── scripts/
│   ├── deploy-operator.sh        # Deploy operator (prebuilt or from source)
│   ├── test-server.sh            # Deploy, test, cleanup single MCP server
│   ├── run-e2e.sh                # Main orchestration script
│   └── cleanup.sh                # Cleanup resources
├── test-servers/
│   ├── example-server-1/
│   │   ├── manifest.yaml         # MCPServer CRD for this server
│   │   ├── test.ts               # TypeScript tests for this server
│   │   └── README.md             # Server-specific documentation
│   ├── example-server-2/
│   │   ├── manifest.yaml
│   │   ├── test.ts
│   │   └── README.md
│   └── template/                 # Template for new test servers
│       ├── manifest.yaml.template
│       └── test.ts.template
├── framework/
│   ├── src/
│   │   ├── mcp-client.ts         # Reusable MCP client library
│   │   ├── k8s-utils.ts          # Kubernetes utilities
│   │   ├── test-framework.ts     # Test framework & assertions
│   │   └── types.ts              # Shared types
│   ├── package.json
│   └── tsconfig.json
├── .github/
│   └── workflows/
│       └── e2e-tests.yaml        # GitHub Actions workflow
├── README.md
└── PLANNING.md                   # This document
```

## Workflow

### 1. Cluster Setup Phase
```bash
# Create Kind cluster
kind create cluster --config cluster/kind-config.yaml --name mcp-e2e-test

# Verify cluster is ready
kubectl wait --for=condition=Ready nodes --all --timeout=300s
```

### 2. Operator Deployment Phase

**Option A: Prebuilt Image with Version Tag (FUTURE WORK)**
```bash
# NOTE: Not yet implemented - operator doesn't have releases yet
# Fetch manifests from GitHub release/tag
OPERATOR_VERSION=${OPERATOR_VERSION:-"v0.1.0"}
MANIFEST_URL="https://raw.githubusercontent.com/kubernetes-sigs/mcp-lifecycle-operator/${OPERATOR_VERSION}/config/release/install.yaml"

curl -fsSL "${MANIFEST_URL}" | kubectl apply -f -
kubectl wait --for=condition=Available deployment/mcp-lifecycle-operator \
  -n mcp-lifecycle-operator-system --timeout=300s
```

**Option B: Build from Source (PRIMARY METHOD)**
```bash
# Create temporary directory for operator build
OPERATOR_DIR=$(mktemp -d)
trap "rm -rf ${OPERATOR_DIR}" EXIT

# Clone operator repo at specific ref
git clone https://github.com/kubernetes-sigs/mcp-lifecycle-operator "${OPERATOR_DIR}"
cd "${OPERATOR_DIR}"
git checkout ${OPERATOR_REF}  # branch/tag/commit

# Build and load into Kind
make docker-build IMG=mcp-operator:test
kind load docker-image mcp-operator:test --name mcp-e2e-test

# Deploy with custom image
make deploy IMG=mcp-operator:test
```

### 3. MCP Server Testing Phase (Sequential)

Tests run one server at a time: deploy → test → cleanup → next server

```bash
# For each MCP server directory
for server_dir in test-servers/*/; do
  server_name=$(basename "${server_dir}")

  echo "Testing ${server_name}..."

  # 1. Deploy the MCP server
  kubectl apply -f "${server_dir}/manifest.yaml"
  kubectl wait --for=condition=Ready mcpserver/${server_name} --timeout=300s

  # 2. Port-forward for test access
  kubectl port-forward svc/${server_name} 8080:8080 &
  PF_PID=$!

  # 3. Run server-specific tests
  cd framework
  npx tsx "../${server_dir}/test.ts"
  TEST_EXIT_CODE=$?

  # 4. Cleanup
  kill ${PF_PID}
  kubectl delete -f "${server_dir}/manifest.yaml"
  kubectl wait --for=delete mcpserver/${server_name} --timeout=60s

  # 5. Check if tests passed
  if [ ${TEST_EXIT_CODE} -ne 0 ]; then
    echo "Tests failed for ${server_name}"
    exit 1
  fi
done
```

### 4. Test Structure (Server-Specific)
```typescript
// test-servers/example-server-1/test.ts
import { MCPClient, TestFramework } from '../../framework/src';

async function main() {
  const framework = new TestFramework('example-server-1');
  const client = new MCPClient('http://localhost:8080');

  await framework.run(async (test) => {
    // Test 1: List tools
    await test('list tools', async () => {
      const tools = await client.listTools();
      test.assert(tools.length > 0, 'Should have at least one tool');
      test.assert(tools[0].name === 'example-tool', 'First tool should be example-tool');
    });

    // Test 2: Call specific tool
    await test('call example-tool', async () => {
      const result = await client.callTool('example-tool', { input: 'test' });
      test.assertEqual(result.success, true);
    });

    // Server-specific test
    await test('verify custom feature', async () => {
      // This test is specific to example-server-1
      const resources = await client.listResources();
      test.assert(resources.some(r => r.uri === 'custom://resource'));
    });
  });

  process.exit(framework.exitCode);
}

main();
```

### 5. Cleanup Phase
```bash
# Collect logs if tests failed
if [ $TEST_EXIT_CODE -ne 0 ]; then
  kubectl logs -l app=mcp-server > logs/mcp-server.log
  kubectl describe mcpserver > logs/mcp-server-describe.txt
fi

# Delete cluster
kind delete cluster --name mcp-e2e-test
```

## Test Framework Design (Reusable Components)

### Core Framework Structure

```typescript
// framework/src/mcp-client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export class MCPClient {
  private client: Client;
  private transport: SSEClientTransport;

  constructor(private baseUrl: string, private timeout: number = 30000) {
    this.transport = new SSEClientTransport(new URL(baseUrl));
    this.client = new Client({
      name: 'mcp-e2e-test-client',
      version: '1.0.0',
    }, {
      capabilities: {},
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  async waitForReady(): Promise<void> {
    // Retry logic to wait for server to be responsive
  }

  async listTools(): Promise<Tool[]> {
    const response = await this.client.listTools();
    return response.tools;
  }

  async callTool(name: string, args: any): Promise<any> {
    const response = await this.client.callTool({ name, arguments: args });
    return response;
  }

  async listResources(): Promise<Resource[]> {
    const response = await this.client.listResources();
    return response.resources;
  }

  async readResource(uri: string): Promise<any> {
    const response = await this.client.readResource({ uri });
    return response;
  }

  async listPrompts(): Promise<Prompt[]> {
    const response = await this.client.listPrompts();
    return response.prompts;
  }

  async getPrompt(name: string, args: any): Promise<any> {
    const response = await this.client.getPrompt({ name, arguments: args });
    return response;
  }
}

// framework/src/test-framework.ts
export class TestFramework {
  private results: TestResult[] = [];
  private currentTest: string = '';

  constructor(private serverName: string) {}

  async run(testSuite: (test: TestFunction) => Promise<void>): Promise<void> {
    console.log(`\n=== Testing ${this.serverName} ===\n`);

    const test: TestFunction = async (name: string, fn: () => Promise<void>) => {
      this.currentTest = name;
      const startTime = Date.now();

      try {
        await fn();
        this.addResult({ name, status: 'passed', duration: Date.now() - startTime });
        console.log(`✓ ${name}`);
      } catch (error) {
        this.addResult({ name, status: 'failed', duration: Date.now() - startTime, error });
        console.log(`✗ ${name}`);
        console.error(`  Error: ${error.message}`);
      }
    };

    // Add assertion methods
    test.assert = (condition: boolean, message: string) => {
      if (!condition) throw new Error(message);
    };

    test.assertEqual = (actual: any, expected: any, message?: string) => {
      if (actual !== expected) {
        throw new Error(message || `Expected ${expected}, got ${actual}`);
      }
    };

    test.assertContains = (array: any[], item: any, message?: string) => {
      if (!array.includes(item)) {
        throw new Error(message || `Array does not contain ${item}`);
      }
    };

    await testSuite(test);
    this.printSummary();
  }

  get exitCode(): number {
    return this.results.some(r => r.status === 'failed') ? 1 : 0;
  }

  private printSummary(): void {
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;

    console.log(`\n=== Results for ${this.serverName} ===`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${this.results.length}\n`);
  }
}

// framework/src/k8s-utils.ts
export class K8sUtils {
  async waitForMCPServer(name: string, timeout: number = 300): Promise<void> { }
  async getMCPServerLogs(name: string): Promise<string> { }
  async deleteMCPServer(name: string): Promise<void> { }
}

// framework/src/types.ts
export interface Tool {
  name: string;
  description?: string;
  inputSchema: any;
}

export interface Resource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface Prompt {
  name: string;
  description?: string;
  arguments?: any[];
}

export interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  duration: number;
  error?: Error;
}

export type TestFunction = {
  (name: string, fn: () => Promise<void>): Promise<void>;
  assert: (condition: boolean, message: string) => void;
  assertEqual: (actual: any, expected: any, message?: string) => void;
  assertContains: (array: any[], item: any, message?: string) => void;
};
```

## Configuration via Environment Variables

Scripts use environment variables for configuration (no config file needed):

```bash
# Operator configuration
OPERATOR_VERSION=${OPERATOR_VERSION:-"v0.1.0"}  # GitHub tag/release version (FUTURE WORK)
OPERATOR_REF=${OPERATOR_REF:-"main"}            # Git ref to build from (branch/tag/commit)

# Cluster configuration
KIND_CLUSTER_NAME=${KIND_CLUSTER_NAME:-"mcp-e2e-test"}
KEEP_CLUSTER=${KEEP_CLUSTER:-"false"}           # Keep cluster after tests for debugging

# Test configuration
KEEP_FAILED_SERVERS=${KEEP_FAILED_SERVERS:-"false"}  # Keep failed servers for manual inspection
SERVER_READY_TIMEOUT=${SERVER_READY_TIMEOUT:-"300"}  # Timeout in seconds for server to be ready
TEST_TIMEOUT=${TEST_TIMEOUT:-"30"}                   # Timeout in seconds for individual tests
PORT_FORWARD_TIMEOUT=${PORT_FORWARD_TIMEOUT:-"10"}   # Timeout in seconds for port-forward
```

### Example Usage

```bash
# Test with specific operator version (prebuilt)
OPERATOR_VERSION=v0.2.0 ./scripts/run-e2e.sh

# Test with operator built from branch
OPERATOR_REF=feature/new-feature ./scripts/run-e2e.sh

# Keep cluster for debugging after failure
KEEP_CLUSTER=true ./scripts/run-e2e.sh
```

## Script Architecture

### Main Orchestration: `scripts/run-e2e.sh`

Entry point that orchestrates the entire test workflow:

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Setup cluster
./cluster/setup.sh

# 2. Deploy operator
./scripts/deploy-operator.sh

# 3. Run tests for each server (sequential)
for server_dir in test-servers/*/; do
  if [ -f "${server_dir}/manifest.yaml" ]; then
    ./scripts/test-server.sh "${server_dir}"
  fi
done

# 4. Cleanup
if [ "${KEEP_CLUSTER:-false}" != "true" ]; then
  ./scripts/cleanup.sh
fi
```

### Individual Scripts

**`cluster/setup.sh`**: Create and configure Kind cluster
- Creates Kind cluster with specific config
- Waits for cluster to be ready
- Configures kubectl context

**`scripts/deploy-operator.sh`**: Deploy MCP lifecycle operator
- Checks if `OPERATOR_REF` is set (build from source)
- Otherwise uses `OPERATOR_VERSION` (fetch prebuilt manifests)
- Waits for operator to be ready

**`scripts/test-server.sh <server-directory>`**: Test single MCP server
- Deploys MCP server from manifest
- Waits for ready
- Starts port-forward
- Runs TypeScript tests
- Collects logs on failure
- Cleans up (deletes server)
- Returns exit code from tests

**`scripts/cleanup.sh`**: Clean up resources
- Deletes Kind cluster
- Removes temporary directories

### Operator Deployment Strategies

**Prebuilt Image (via `OPERATOR_VERSION`)**:
1. Fetch manifests from GitHub release tag
2. Apply manifests to cluster
3. Wait for operator to be ready
4. Fast, deterministic, suitable for stable versions

**Build from Source (via `OPERATOR_REF`)**:
1. Create temporary directory
2. Clone operator repository
3. Checkout specific branch/tag/commit
4. Build Docker image using Makefile
5. Load image into Kind cluster
6. Deploy using operator's manifests
7. Useful for testing PRs or unreleased features

## Output Format

### Console Output
```
=== MCP E2E Test Suite ===
[SETUP] Creating Kind cluster... ✓
[SETUP] Deploying operator (v0.1.0)... ✓

[SERVER] Testing example-server-1...
  [DEPLOY] Applying manifest... ✓
  [DEPLOY] Waiting for ready... ✓
  [DEPLOY] Port-forwarding to localhost:8080... ✓

  === Testing example-server-1 ===
  ✓ list tools
  ✓ call example-tool
  ✗ list resources
    Error: Timeout waiting for response

  === Results for example-server-1 ===
  Passed: 2
  Failed: 1
  Total: 3

  [CLEANUP] Removing MCP server... ✓

[SERVER] Testing example-server-2...
  [DEPLOY] Applying manifest... ✓
  [DEPLOY] Waiting for ready... ✓
  [DEPLOY] Port-forwarding to localhost:8080... ✓

  === Testing example-server-2 ===
  ✓ list prompts
  ✓ call prompt with args

  === Results for example-server-2 ===
  Passed: 2
  Failed: 0
  Total: 2

  [CLEANUP] Removing MCP server... ✓

[CLEANUP] Deleting cluster... ✓

=== Overall Results ===
Servers tested: 2
Tests passed: 4
Tests failed: 1
Total tests: 5
Duration: 45s

Exit code: 1 (failures detected)
```

### JSON Output
```json
{
  "summary": {
    "passed": 3,
    "failed": 1,
    "total": 4,
    "duration": 45000
  },
  "tests": [
    {
      "server": "example-server-1",
      "name": "list_tools",
      "status": "passed",
      "duration": 120
    },
    {
      "server": "example-server-1",
      "name": "list_resources",
      "status": "failed",
      "error": "Timeout waiting for response",
      "duration": 30000
    }
  ]
}
```

## CI/CD Integration

### GitHub Actions Workflow

The same scripts work both locally and in CI:

```yaml
name: E2E Tests

on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight UTC
  workflow_dispatch:      # Manual trigger option

jobs:
  e2e-from-source:
    name: E2E Tests (Operator from main)
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install framework dependencies
        run: cd framework && npm ci

      - name: Setup Kind
        uses: helm/kind-action@v1
        with:
          install_only: true

      - name: Run E2E tests (build operator from main)
        env:
          OPERATOR_REF: main
        run: ./scripts/run-e2e.sh

      - name: Upload logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-logs
          path: logs/
          retention-days: 7
```

### Local Testing

Same commands work locally as in CI:

```bash
# Install dependencies
cd framework && npm install

# Run tests (uses default operator version)
./scripts/run-e2e.sh

# Or with specific version
OPERATOR_VERSION=v0.2.0 ./scripts/run-e2e.sh
```

## MCP Server Directory Template

Each MCP server follows this structure:

```
test-servers/example-server/
├── manifest.yaml          # MCPServer CRD
├── test.ts               # Server-specific tests
└── README.md             # Server documentation (optional)
```

### Example `manifest.yaml`
```yaml
apiVersion: mcp.kubernetes.io/v1alpha1
kind: MCPServer
metadata:
  name: example-server
  namespace: default
spec:
  image: ghcr.io/example/mcp-server:v1.0.0
  port: 8080
  env:
    - name: LOG_LEVEL
      value: debug
```

### Example `test.ts`
```typescript
#!/usr/bin/env node
import { MCPClient, TestFramework } from '../../framework/src';

async function main() {
  const framework = new TestFramework('example-server');
  const client = new MCPClient('http://localhost:8080');

  await framework.run(async (test) => {
    // Common tests (can be used across servers)
    await test('server is reachable', async () => {
      await client.waitForReady();
    });

    await test('lists available tools', async () => {
      const tools = await client.listTools();
      test.assert(tools.length > 0, 'Server should have at least one tool');
    });

    // Server-specific tests
    await test('example-tool exists and works', async () => {
      const tools = await client.listTools();
      const exampleTool = tools.find(t => t.name === 'example-tool');
      test.assert(exampleTool !== undefined, 'example-tool should exist');

      const result = await client.callTool('example-tool', {
        input: 'test data'
      });
      test.assertEqual(result.success, true);
      test.assert(result.output.includes('expected string'));
    });

    await test('provides specific resource', async () => {
      const resources = await client.listResources();
      test.assertContains(
        resources.map(r => r.uri),
        'resource://example/data'
      );
    });
  });

  process.exit(framework.exitCode);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

### Example `README.md`
```markdown
# Example MCP Server

Tests for the example MCP server.

## What this server provides

- **Tools**: example-tool for processing data
- **Resources**: resource://example/data
- **Prompts**: None

## Test coverage

- Server reachability
- Tool listing and execution
- Resource availability

## Known issues

None
```

## Testing Different Scenarios

### Scenario 1: Add New MCP Server for Testing
```bash
# 1. Create directory for new server
mkdir -p test-servers/my-new-server

# 2. Create manifest
cat > test-servers/my-new-server/manifest.yaml <<EOF
apiVersion: mcp.kubernetes.io/v1alpha1
kind: MCPServer
metadata:
  name: my-new-server
spec:
  image: myregistry/my-mcp-server:v1.0.0
  port: 8080
EOF

# 3. Create test file
cat > test-servers/my-new-server/test.ts <<'EOF'
import { MCPClient, TestFramework } from '../../framework/src';

async function main() {
  const framework = new TestFramework('my-new-server');
  const client = new MCPClient('http://localhost:8080');

  await framework.run(async (test) => {
    await test('basic functionality', async () => {
      const tools = await client.listTools();
      test.assert(tools.length > 0, 'Should have tools');
    });
  });

  process.exit(framework.exitCode);
}

main();
EOF

# 4. Run all E2E tests (includes new server)
./scripts/run-e2e.sh
```

### Scenario 2: Test Specific Operator Version
```bash
# Test with specific prebuilt operator version
OPERATOR_VERSION=v0.2.0 ./scripts/run-e2e.sh
```

### Scenario 3: Test Operator PR/Branch
```bash
# Build operator from branch and test
OPERATOR_REF=feature/new-feature ./scripts/run-e2e.sh

# Build from PR
OPERATOR_REF=pull/123/head ./scripts/run-e2e.sh
```

### Scenario 4: Local Development/Debugging
```bash
# Keep cluster after tests for manual inspection
KEEP_CLUSTER=true ./scripts/run-e2e.sh

# After test failure, inspect manually
kubectl get mcpservers
kubectl get pods
kubectl logs <pod-name>
kubectl describe mcpserver <server-name>

# When done, cleanup manually
kind delete cluster --name mcp-e2e-test
```

### Scenario 5: Test Single Server (Manual)
```bash
# Setup cluster and operator
./scripts/cluster/setup.sh
./scripts/deploy-operator.sh

# Test specific server
./scripts/test-server.sh test-servers/my-server

# Cleanup
./scripts/cleanup.sh
```

## Dependencies

### Required Tools
- Docker (for Kind)
- kubectl
- kind
- Node.js 20+ (for TypeScript tests)
- npm or yarn (for dependency management)
- jq (for JSON processing in scripts)
- git (for operator source builds)

### TypeScript/Node.js Dependencies
Framework `package.json` will include:
- `@modelcontextprotocol/sdk` - Official MCP SDK for client communication
- `tsx` - TypeScript execution (for running tests directly)
- `typescript` - TypeScript compiler
- `@types/node` - Node.js type definitions

### Optional Tools
- make (for operator builds)
- go 1.21+ (for operator builds from source)

## Implementation Phases

### Phase 1: Basic Infrastructure (MVP)
- [ ] Directory structure setup
- [ ] Kind cluster setup script (`cluster/setup.sh`) - basic single-node
- [ ] Operator deployment script - build from source (`scripts/deploy-operator.sh`)
- [ ] Basic reusable framework:
  - [ ] MCPClient class (wrapping MCP SDK with SSE/streamable HTTP support)
  - [ ] TestFramework class (with continue-on-failure)
  - [ ] Basic types
  - [ ] package.json with MCP SDK dependency
- [ ] Support for 2 user-provided MCP servers (manifests provided)
- [ ] Test orchestration script (`scripts/test-server.sh`)
  - [ ] Deploy server
  - [ ] Read service name from CR status
  - [ ] Port-forward with timeout
  - [ ] Run tests
  - [ ] Collect logs (always)
  - [ ] Cleanup (unless KEEP_FAILED_SERVERS=true on failure)
- [ ] Main E2E script (`scripts/run-e2e.sh`)
  - [ ] Continue testing on failure
  - [ ] Aggregate results
- [ ] Console output with pass/fail
- [ ] Cleanup script (respects KEEP_CLUSTER and KEEP_FAILED_SERVERS)

### Phase 2: Enhanced Testing
- [ ] Add more example MCP servers with tests (if needed)
- [ ] Enhanced test framework assertions (more helper methods)
- [ ] K8s utilities for advanced operations
- [ ] Template directory for new servers
- [ ] Better error messages and debugging output
- [ ] Documentation and README updates

### Phase 3: CI/CD Integration
- [ ] GitHub Actions workflow (daily + manual trigger)
- [ ] Log artifact upload (always, not just on failure)
- [ ] Status badges
- [ ] Notification on failure (optional)

### Phase 4: Future Enhancements
- [ ] Prebuilt operator manifest support (when releases exist)
- [ ] Matrix testing (multiple operator versions)
- [ ] JSON output format for programmatic consumption
- [ ] Performance metrics collection
- [ ] Support for different transport types per server
- [ ] Advanced K8s scenarios (network policies, resource limits, etc.)

### Phase 4: Polish & Advanced Features (Optional)
- [ ] JSON output format for programmatic consumption
- [ ] Performance metrics collection
- [ ] Test result history/trending
- [ ] Support for MCP server authentication
- [ ] Network policy testing
- [ ] Multi-namespace testing

## Answered Questions

### 1. MCP Protocol Communication
✅ **Decision**: Use the official MCP SDK (`@modelcontextprotocol/sdk`)
- Framework will wrap the SDK in a convenient `MCPClient` class
- Supports SSE and streamable HTTP transports
- Transport type depends on MCP server implementation (configured per-server)

### 2. Port-forwarding Strategy
✅ **Decision**: Use `kubectl port-forward` for each test
- Read service name from MCPServer CR status
- Start port-forward before running tests
- Tests connect to `http://localhost:8080`
- Kill port-forward process after tests complete
- Default timeout: 10s for port-forward to be ready
- Simple, works locally and in CI

### 3. Test Isolation
✅ **Decision**: One cluster for all tests, sequential server testing
- Create cluster once at start
- Deploy/test/remove servers one at a time
- Clean up cluster at end (unless `KEEP_CLUSTER=true`)
- Efficient and provides clean isolation between servers

### 4. Authentication/Authorization
✅ **Decision**: No authentication required for testing
- MCP servers are deployed without auth
- Tests connect directly without credentials
- Simplifies test implementation

### 5. Test Data Management
✅ **Decision**: Per-server data preparation (handled in test files)
- Some servers may need data setup before tests
- Each server's `test.ts` handles its own data prep if needed
- Framework provides utilities for common operations
- Data cleanup happens when server is deleted

Example with data prep:
```typescript
await framework.run(async (test) => {
  // Optional: prepare data before tests
  await setupTestData();

  await test('server processes data', async () => {
    // ... test logic
  });

  // Optional: cleanup happens automatically when server is deleted
});
```

### 6. Test Failure Behavior
✅ **Decision**: Continue testing all servers on failure
- If one server's tests fail, continue with remaining servers
- Collect all results before exiting
- Exit with failure code if any tests failed
- Environment variable `KEEP_FAILED_SERVERS=true` keeps failed servers deployed for manual inspection
- Failed server logs always collected to `logs/` directory

### 7. Log Collection
✅ **Decision**: Always collect logs
- Collect MCP server logs for all tests (pass or fail)
- Logs saved to `logs/<server-name>.log`
- Helps with debugging and audit trail
- Uploaded as artifacts in CI on failure

### 8. Timeout Configuration
✅ **Decision**: Fixed default timeouts (configurable via env vars)
- Server ready wait: 300s (5 minutes)
- Individual test timeout: 30s
- Port-forward ready: 10s
- Can be overridden via environment variables if needed

### 9. Kind Cluster Configuration
✅ **Decision**: Basic single-node cluster
- No special configuration needed
- Single control-plane node
- Default networking
- Sufficient for MCP server testing

### 10. Example MCP Servers
✅ **Decision**: 2 example servers provided by user
- User will provide manifests for 2 MCP servers
- Demonstrates variety (different transports, features)
- Phase 1 will create framework to support them

### 11. CI/CD Triggers
✅ **Decision**: Daily scheduled runs
- GitHub Actions runs E2E tests daily
- Catches regressions and operator changes
- Manual trigger option also available
- Can add PR triggers later if needed

## Key Design Decisions Summary

1. **Sequential Testing**: Deploy one server → test → cleanup → next server (simpler, cleaner isolation)
2. **Reusable Framework**: Common utilities in `framework/` directory, server-specific tests in their own directories
3. **Script-Based**: No config files, use environment variables and shell scripts (works locally + CI)
4. **Build from Source**: Operator built from source (prebuilt manifests = future work when releases exist)
5. **Temporary Directories**: Use `mktemp -d` for operator builds, proper cleanup with traps
6. **Each Server Isolated**: Each MCP server has its own directory with manifest + tests
7. **MCP SDK**: Use official `@modelcontextprotocol/sdk` for client communication (SSE + streamable HTTP transports)
8. **Port-forwarding**: Use `kubectl port-forward` to expose servers to tests (service name from CR status)
9. **Single Cluster**: One Kind cluster (basic single-node) for all tests
10. **No Auth**: MCP servers deployed without authentication for testing
11. **Per-Server Data Prep**: Tests handle their own data setup if needed
12. **Continue on Failure**: Test all servers even if some fail; collect all results
13. **Keep Failed Servers**: `KEEP_FAILED_SERVERS=true` keeps failed deployments for debugging
14. **Always Log**: Collect logs for all tests (pass or fail) to `logs/` directory
15. **Daily CI**: GitHub Actions runs daily + manual trigger option
16. **Fixed Timeouts**: 300s server ready, 30s per test, 10s port-forward (configurable via env vars)

## Decisions Made Based on Feedback

### Initial Feedback
✅ Prebuilt manifests fetched from GitHub repo tags (marked as future work)
✅ Proper temp directory handling (`mktemp -d`)
✅ Sequential server testing (deploy → test → remove → next)
✅ Server-specific tests with reusable framework
✅ Each server in own directory
✅ No config.yaml - script-based approach
✅ Designed for both GitHub Actions and local execution

### Q&A Session Decisions
✅ MCP SDK with SSE and streamable HTTP support
✅ Service name from MCPServer CR status
✅ kubectl port-forward for server access
✅ Continue testing all servers on failure
✅ `KEEP_FAILED_SERVERS=true` to keep failed deployments
✅ Always collect logs (not just on failure)
✅ Fixed timeouts with env var overrides
✅ Basic single-node Kind cluster
✅ 2 user-provided example servers
✅ Daily scheduled CI runs + manual trigger
✅ Build operator from source (primary method)

## Next Steps

1. ✅ Planning document complete and validated
2. ✅ All open questions answered
3. **Ready for Phase 1 implementation:**
   - Set up directory structure
   - Create Kind cluster setup script (`cluster/setup.sh`)
   - Create operator deployment script (`scripts/deploy-operator.sh`)
   - Build reusable TypeScript framework (with MCP SDK)
   - Add 2 user-provided MCP servers with tests
   - Create test orchestration script (`scripts/test-server.sh`)
   - Create main E2E script (`scripts/run-e2e.sh`)
   - Create cleanup script (`scripts/cleanup.sh`)
4. Test locally with both example servers
5. Add GitHub Actions workflow (daily + manual)
6. Document usage in README