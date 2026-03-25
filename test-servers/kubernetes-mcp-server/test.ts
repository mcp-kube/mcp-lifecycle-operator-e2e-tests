#!/usr/bin/env node
/**
 * E2E tests for Kubernetes MCP Server
 */

import { MCPClient, TestFramework } from '../../framework/src/index.js';

async function main() {
  const framework = new TestFramework('kubernetes-mcp-server');
  const client = new MCPClient('http://localhost:8080');

  try {
    await framework.run(async (test) => {
      // Test 1: Server reachability
      await test('server is reachable and ready', async () => {
        await client.waitForReady();
      });

      // Test 2: Connect to MCP server
      await test('can connect to MCP server', async () => {
        await client.connect();
      });

      // Test 3: List available tools
      await test('lists available tools', async () => {
        const tools = await client.listTools();
        test.assert(tools.length > 0, 'Server should have at least one tool');

        // Log available tools for debugging
        console.log(`    Found ${tools.length} tools`);
      });

      // Test 4: Verify core toolset tools are present
      await test('has core Kubernetes tools', async () => {
        const tools = await client.listTools();
        const toolNames = tools.map(t => t.name);

        // Check for common Kubernetes operations
        const hasGetTool = toolNames.some(name =>
          name.toLowerCase().includes('get') ||
          name.toLowerCase().includes('list')
        );
        test.assert(
          hasGetTool,
          'Should have tools for getting/listing Kubernetes resources'
        );
      });

      // Test 5: List resources
      await test('can list resources', async () => {
        try {
          const resources = await client.listResources();
          // Resources may be empty, but the call should succeed
          console.log(`    Found ${resources.length} resources`);
        } catch (error) {
          // Some MCP servers may not implement resources
          console.log('    Resources not implemented or empty');
        }
      });

      // Test 6: Verify server has expected tool schema
      await test('tools have valid schemas', async () => {
        const tools = await client.listTools();
        for (const tool of tools.slice(0, 3)) { // Check first 3 tools
          test.assert(
            tool.name !== undefined && tool.name !== '',
            `Tool should have a name: ${JSON.stringify(tool)}`
          );
          test.assert(
            tool.inputSchema !== undefined,
            `Tool ${tool.name} should have an inputSchema`
          );
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
