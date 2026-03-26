#!/usr/bin/env node
/**
 * E2E tests for Kubernetes MCP Server
 */

import { MCPClient, TestFramework, runCommonTests } from '../../framework/src/index.js';

async function main() {
  const framework = new TestFramework('kubernetes-mcp-server');
  const client = new MCPClient('http://localhost:8080');

  try {
    await framework.run(async (test) => {
      // Run common baseline tests (reachability, connection, list tools)
      await runCommonTests(test, client);

      // List namespaces using the namespaces_list tool
      await test('can list namespaces', async () => {
        console.log(`    Calling tool: namespaces_list`);
        const result = await client.callTool('namespaces_list', {});

        test.assert(result !== undefined, 'Tool should return a result');

        if (result.content && Array.isArray(result.content)) {
          for (const item of result.content) {
            if (item.type === 'text' && item.text) {
              console.log(`    Response text:\n===========\n`, item.text, `\n===========`);
            } else {
                console.log(`    Item:`, item);
            }
          }
        }
      });

      // List pods in default namespace using the pods_list tool
      await test('can list pods in default namespace', async () => {
        console.log(`    Calling tool: pods_list`);
        const result = await client.callTool('pods_list', { namespace: 'default' });

        test.assert(result !== undefined, 'Tool should return a result');

        if (result.content && Array.isArray(result.content)) {
          for (const item of result.content) {
            if (item.type === 'text' && item.text) {
              console.log(`    Response text:\n===========`, item.text, `\n===========`);
            } else {
              console.log(`    Item:`, item);
            }
          }
        }
      });

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
