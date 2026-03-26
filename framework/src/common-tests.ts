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

/**
 * Test that a tool can be called successfully and log the response
 *
 * @param test - The test function
 * @param client - The MCP client
 * @param testName - Name of the test
 * @param toolName - Name of the tool to call
 * @param args - Arguments to pass to the tool
 * @returns The tool call result
 */
export async function testCallTool(
  test: TestFunction,
  client: MCPClient,
  testName: string,
  toolName: string,
  args: any = {}
): Promise<any> {
  return await test(testName, async () => {
    console.log(`    Calling tool: ${toolName}`);
    const result = await client.callTool(toolName, args);

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

    return result;
  });
}