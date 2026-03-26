#!/usr/bin/env node
/**
 * E2E tests for Kubernetes MCP Server
 */

import { MCPClient, TestFramework, runCommonTests, testCallTool } from '../../framework/src/index.js';

async function main() {
  const framework = new TestFramework('kubernetes-mcp-server');
  const client = new MCPClient('http://localhost:8080');

  try {
    await framework.run(async (test) => {
      // Run common baseline tests (reachability, connection, list tools)
      await runCommonTests(test, client);

      // List namespaces using the namespaces_list tool
      await testCallTool(test, client, 'can list namespaces', 'namespaces_list', {});

      // List pods in default namespace using the pods_list tool
      await testCallTool(test, client, 'can list pods in default namespace', 'pods_list', { namespace: 'default' });

      // Cleanup: Disconnect from server
      await client.disconnect();
    });
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }

  process.exit(framework.exitCode);
}

main();
