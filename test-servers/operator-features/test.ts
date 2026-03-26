#!/usr/bin/env node
/**
 * E2E tests for MCP Lifecycle Operator Features
 *
 * Uses a simple HTTP client instead of the SSE-based MCP client
 */

import { TestFramework } from '../../framework/src/index.js';

// Simple HTTP-based MCP client
class SimpleHTTPClient {
  private baseUrl: string;
  private requestId: number = 0;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async initialize() {
    return await this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
  }

  async listTools() {
    const result = await this.request('tools/list', {});
    return result.tools;
  }

  async callTool(name: string, args: any) {
    return await this.request('tools/call', { name, arguments: args });
  }

  private async request(method: string, params: any) {
    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.requestId,
        method,
        params,
      }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(`MCP error: ${data.error.message}`);
    }
    return data.result;
  }
}

async function main() {
  const framework = new TestFramework('operator-features');
  const client = new SimpleHTTPClient('http://localhost:8080');

  try {
    await framework.run(async (test) => {
      // Initialize
      await test('can initialize connection', async () => {
        const result = await client.initialize();
        test.assert(result.serverInfo.name === 'operator-features-validator', 'Server name should match');
      });

      // List tools
      await test('can list tools', async () => {
        const tools = await client.listTools();
        test.assert(tools.length > 0, 'Should have at least one tool');
        console.log(`    Found ${tools.length} tools`);
      });

      // Test: Verify secret files are mounted
      await test('secret is mounted at /secrets', async () => {
        const result = await client.callTool('list_directory', { path: '/secrets' });
        const data = JSON.parse(result.content[0].text);

        test.assert(data.error === null, 'Directory should exist');
        const fileNames = data.entries.map((e: any) => e.name);
        test.assert(fileNames.includes('username'), 'Secret file "username" should exist');
        test.assert(fileNames.includes('password'), 'Secret file "password" should exist');
      });

      // Test: Verify secret file contents
      await test('secret files contain correct data', async () => {
        const usernameResult = await client.callTool('check_file_exists', { path: '/secrets/username' });
        const usernameData = JSON.parse(usernameResult.content[0].text);

        test.assert(usernameData.exists, 'Username file should exist');
        test.assertEqual(usernameData.content.trim(), 'admin', 'Username should be "admin"');
      });

      // Test: Verify ConfigMap is mounted
      await test('configmap is mounted at /config', async () => {
        const result = await client.callTool('list_directory', { path: '/config' });
        const data = JSON.parse(result.content[0].text);

        test.assert(data.error === null, 'Directory should exist');
        const fileNames = data.entries.map((e: any) => e.name);
        test.assert(fileNames.includes('app.conf'), 'ConfigMap file "app.conf" should exist');
      });

      // Test: Verify ConfigMap file contents
      await test('configmap file contains correct data', async () => {
        const result = await client.callTool('check_file_exists', { path: '/config/app.conf' });
        const data = JSON.parse(result.content[0].text);

        test.assert(data.exists, 'Config file should exist');
        test.assert(data.content.includes('server_mode = production'), 'Config should have server_mode');
      });

      // Test: Verify environment variables
      await test('environment variables are set correctly', async () => {
        const testEnvResult = await client.callTool('get_env_var', { name: 'TEST_ENV_VAR' });
        const testEnvData = JSON.parse(testEnvResult.content[0].text);

        test.assert(testEnvData.exists, 'TEST_ENV_VAR should exist');
        test.assertEqual(testEnvData.value, 'test-value-123', 'TEST_ENV_VAR should have correct value');
      });

      // Test: Verify security context (user/group IDs)
      await test('security context user IDs are correct', async () => {
        const result = await client.callTool('check_user_id', {});
        const data = JSON.parse(result.content[0].text);

        test.assertEqual(data.uid, 1000, 'UID should be 1000');
        test.assertEqual(data.gid, 3000, 'GID should be 3000');
        test.assert(data.groups.includes(2000), 'Should be in group 2000 (fsGroup)');
      });

      // Test: Verify file permissions reflect fsGroup
      await test('file permissions reflect fsGroup', async () => {
        const result = await client.callTool('get_file_permissions', { path: '/secrets' });
        const data = JSON.parse(result.content[0].text);

        test.assert(data.exists, '/secrets should exist');
        test.assertEqual(data.permissions.gid, 2000, 'fsGroup should be 2000');
      });
    });
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }

  process.exit(framework.exitCode);
}

main();