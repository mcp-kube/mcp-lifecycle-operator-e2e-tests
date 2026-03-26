# MCP Server E2E Testing Framework

Automated end-to-end testing framework for MCP (Model Context Protocol) server images deployed via the Kubernetes MCP lifecycle operator.

## Overview

This framework provides a complete testing solution for MCP servers running on Kubernetes:

- **Automated cluster management** - Creates and manages Kind (Kubernetes in Docker) clusters
- **Operator deployment** - Builds and deploys the MCP lifecycle operator from source
- **Test orchestration** - Deploys MCP servers, runs tests, collects logs, and cleans up
- **TypeScript test framework** - Reusable libraries for writing MCP server tests
- **Comprehensive reporting** - Clear console output with pass/fail status and logs

## Quick Start

### Prerequisites

Required tools:
- Docker (for Kind)
- kubectl
- kind
- Node.js 20+
- npm
- jq (for JSON processing)
- git (for operator source builds)

Optional (for building operator from source):
- make
- go 1.21+

### Installation

1. Install framework dependencies:
```bash
cd framework
npm install
```

2. Run all E2E tests:
```bash
./scripts/run-e2e.sh
```

This will:
1. Create a Kind cluster
2. Build and deploy the MCP lifecycle operator from source
3. Build and load any custom MCP server images (from test-servers/*/server/ directories)
4. Test each MCP server in the `test-servers/` directory sequentially
5. Collect logs and display results
6. Clean up the cluster

## Usage

### Running Tests

**Run all tests (default configuration):**
```bash
./scripts/run-e2e.sh
```

**Test with specific operator version:**
```bash
OPERATOR_REF=main ./scripts/run-e2e.sh
```

**Keep cluster after tests for debugging:**
```bash
KEEP_CLUSTER=true ./scripts/run-e2e.sh
```

**Keep failed servers deployed for manual inspection:**
```bash
KEEP_FAILED_SERVERS=true ./scripts/run-e2e.sh
```

### Individual Scripts

**Setup cluster only:**
```bash
./cluster/setup.sh
```

**Deploy operator only:**
```bash
./scripts/deploy-operator.sh
```

**Test a single server:**
```bash
./scripts/test-server.sh test-servers/kubernetes-mcp-server
```

**Cleanup resources:**
```bash
./scripts/cleanup.sh
```

## Configuration

All configuration is done via environment variables:

### Operator Configuration
- `OPERATOR_REF` - Git ref to build operator from (default: `main`)
- `OPERATOR_IMAGE` - Docker image name for operator (default: `mcp-operator:test`)

### Cluster Configuration
- `KIND_CLUSTER_NAME` - Name of Kind cluster (default: `mcp-e2e-test`)
- `KEEP_CLUSTER` - Keep cluster after tests (default: `false`)

### Test Configuration
- `KEEP_FAILED_SERVERS` - Keep failed servers for inspection (default: `false`)
- `SERVER_READY_TIMEOUT` - Timeout for server to be ready in seconds (default: `300`)
- `TEST_TIMEOUT` - Timeout for individual tests in seconds (default: `30`)
- `PORT_FORWARD_TIMEOUT` - Timeout for port-forward in seconds (default: `10`)

### Example Usage

```bash
# Test with operator built from specific branch
OPERATOR_REF=feature/new-feature ./scripts/run-e2e.sh

# Keep cluster and failed servers for debugging
KEEP_CLUSTER=true KEEP_FAILED_SERVERS=true ./scripts/run-e2e.sh

# Use longer timeouts for slow environments
SERVER_READY_TIMEOUT=600 ./scripts/run-e2e.sh
```

## Directory Structure

```
.
├── cluster/
│   ├── kind-config.yaml          # Kind cluster configuration
│   └── setup.sh                  # Cluster setup script
├── scripts/
│   ├── deploy-operator.sh        # Deploy operator from source
│   ├── test-server.sh            # Deploy, test, cleanup single server
│   ├── run-e2e.sh                # Main orchestration script
│   └── cleanup.sh                # Cleanup resources
├── test-servers/
│   ├── kubernetes-mcp-server/    # Example MCP server tests
│   │   ├── manifest.yaml         # MCPServer CRD
│   │   ├── test.ts               # TypeScript tests
│   │   └── README.md             # Server documentation
│   └── template/                 # Template for new servers
├── framework/
│   ├── src/
│   │   ├── mcp-client.ts         # MCP client library
│   │   ├── k8s-utils.ts          # Kubernetes utilities
│   │   ├── test-framework.ts     # Test framework
│   │   ├── types.ts              # Shared types
│   │   └── index.ts              # Main exports
│   ├── package.json
│   └── tsconfig.json
├── logs/                         # Test logs (created at runtime)
├── README.md                     # This file
└── PLANNING.md                   # Detailed planning document
```

## Adding a New MCP Server

1. Create a new directory in `test-servers/`:
```bash
mkdir -p test-servers/my-server
```

2. Create a `manifest.yaml` with your MCPServer CRD:
```yaml
apiVersion: mcp.x-k8s.io/v1alpha1
kind: MCPServer
metadata:
  name: my-server
  namespace: default
spec:
  source:
    type: ContainerImage
    containerImage:
      ref: myregistry/my-mcp-server:v1.0.0
  config:
    port: 8080
```

3. Create a `test.ts` file:
```typescript
#!/usr/bin/env node
import { MCPClient, TestFramework } from '../../framework/src/index.js';

async function main() {
  const framework = new TestFramework('my-server');
  const client = new MCPClient('http://localhost:8080');

  try {
    await framework.run(async (test) => {
      await test('server is reachable', async () => {
        await client.waitForReady();
        await client.connect();
      });

      await test('lists available tools', async () => {
        const tools = await client.listTools();
        test.assert(tools.length > 0, 'Should have at least one tool');
      });

      await client.disconnect();
    });
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }

  process.exit(framework.exitCode);
}

main();
```

4. Make the test executable:
```bash
chmod +x test-servers/my-server/test.ts
```

5. Run all tests (including your new server):
```bash
./scripts/run-e2e.sh
```

## Test Framework API

### MCPClient

```typescript
const client = new MCPClient('http://localhost:8080', {
  timeout: 30000,      // Request timeout (default: 30000ms)
  maxRetries: 5,       // Max connection retries (default: 5)
  retryDelay: 2000,    // Delay between retries (default: 2000ms)
});

// Wait for server to be ready
await client.waitForReady();

// Connect to server
await client.connect();

// List tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool('tool-name', { arg: 'value' });

// List resources
const resources = await client.listResources();

// Read a resource
const data = await client.readResource('resource://uri');

// List prompts
const prompts = await client.listPrompts();

// Get a prompt
const prompt = await client.getPrompt('prompt-name', { arg: 'value' });

// Disconnect
await client.disconnect();
```

### TestFramework

```typescript
const framework = new TestFramework('server-name');

await framework.run(async (test) => {
  // Define tests
  await test('test name', async () => {
    // Assertions
    test.assert(condition, 'error message');
    test.assertEqual(actual, expected, 'optional message');
    test.assertContains(array, item, 'optional message');
    test.assertDeepEqual(actual, expected, 'optional message');
  });
});

// Exit with appropriate code
process.exit(framework.exitCode);
```

## Workflow

1. **Cluster Setup** - Creates Kind cluster and waits for readiness
2. **Operator Deployment** - Builds operator from source and deploys to cluster
3. **Server Testing** (for each server, sequentially):
   - Deploy MCPServer CRD
   - Wait for server to be ready
   - Get service name from CR status
   - Port-forward to localhost:8080
   - Run TypeScript tests
   - Collect logs
   - Cleanup server (unless tests failed and `KEEP_FAILED_SERVERS=true`)
4. **Cleanup** - Delete cluster (unless `KEEP_CLUSTER=true`)

## Debugging

### View test logs
```bash
cat logs/kubernetes-mcp-server.log
cat logs/kubernetes-mcp-server-describe.txt
```

### Keep cluster for manual inspection
```bash
KEEP_CLUSTER=true ./scripts/run-e2e.sh

# Then inspect manually
kubectl get mcpservers --all-namespaces
kubectl get pods --all-namespaces
kubectl logs <pod-name> -n <namespace>
kubectl describe mcpserver <server-name> -n <namespace>

# Cleanup when done
./scripts/cleanup.sh
```

### Keep failed servers deployed
```bash
KEEP_FAILED_SERVERS=true ./scripts/run-e2e.sh

# Failed servers will remain deployed for inspection
# Manual cleanup instructions will be displayed
```

### Test single server
```bash
# Setup cluster and operator first
./cluster/setup.sh
./scripts/deploy-operator.sh

# Test specific server
./scripts/test-server.sh test-servers/kubernetes-mcp-server

# Cleanup
./scripts/cleanup.sh
```

## CI/CD Integration

The framework is designed to work both locally and in CI environments. See `.github/workflows/e2e-tests.yaml` for GitHub Actions integration.

## License

Apache-2.0

## Contributing

See PLANNING.md for detailed design decisions and architecture.
