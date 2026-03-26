/**
 * Common test functions that can be reused across different MCP server tests
 */

import { MCPClient } from './mcp-client.js';
import type { TestFunction } from './types.js';

/**
 * Test that the server is reachable and ready
 */
export async function testServerReachable(test: TestFunction, client: MCPClient) {
  await test('server is reachable and ready', async () => {
    await client.waitForReady();
  });
}

/**
 * Test that we can connect to the MCP server
 */
export async function testCanConnect(test: TestFunction, client: MCPClient) {
  await test('can connect to MCP server', async () => {
    await client.connect();
  });
}

/**
 * Test that the server lists available tools and log them
 */
export async function testListTools(test: TestFunction, client: MCPClient) {
  await test('lists available tools', async () => {
    const tools = await client.listTools();
    test.assert(tools.length > 0, 'Server should have at least one tool');

    // Log available tools for debugging
    console.log(`    Found ${tools.length} tools:`);
    tools.forEach(tool => {
      console.log(`      - ${tool.name}: ${tool.description || '(no description)'}`);
    });
  });
}

/**
 * Run all common baseline tests
 * This is a convenience function that runs all common tests in sequence
 */
export async function runCommonTests(test: TestFunction, client: MCPClient) {
  await testServerReachable(test, client);
  await testCanConnect(test, client);
  await testListTools(test, client);
}