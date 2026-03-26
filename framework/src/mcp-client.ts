/**
 * MCP Client wrapper for E2E testing
 * Supports both SSE and plain HTTP transports
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Tool, Resource, Prompt } from './types.js';

export interface MCPClientOptions {
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  transport?: 'sse' | 'http';
}

export class MCPClient {
  private client?: Client;
  private transport?: SSEClientTransport;
  private connected: boolean = false;
  private timeout: number;
  private maxRetries: number;
  private retryDelay: number;
  private transportType: 'sse' | 'http';
  private requestId: number = 0;

  constructor(
    private baseUrl: string,
    options: MCPClientOptions = {}
  ) {
    this.timeout = options.timeout ?? 30000;
    this.maxRetries = options.maxRetries ?? 5;
    this.retryDelay = options.retryDelay ?? 2000;
    this.transportType = options.transport ?? 'sse';

    if (this.transportType === 'sse') {
      this.transport = new SSEClientTransport(new URL(`${baseUrl}/sse`));
      this.client = new Client(
        {
          name: 'mcp-e2e-test-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );
    }
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.transportType === 'sse') {
      await this.client!.connect(this.transport!);
    } else {
      // HTTP transport - initialize
      await this.httpRequest('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcp-e2e-test-client', version: '1.0.0' },
      });
    }

    this.connected = true;
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    if (this.transportType === 'sse' && this.client) {
      await this.client.close();
    }

    this.connected = false;
  }

  /**
   * Wait for the MCP server to be ready
   * Retries until the server is responding or max retries reached
   * Does not connect - call connect() separately after this succeeds
   */
  async waitForReady(): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Try to fetch the base URL to check if server is up
        const response = await fetch(this.baseUrl, {
          signal: AbortSignal.timeout(this.timeout),
        });

        if (response.ok || response.status === 404) {
          // Server is responding
          return;
        }
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay);
        }
      }
    }

    throw new Error(
      `Server not ready after ${this.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * List available tools from the MCP server
   */
  async listTools(): Promise<Tool[]> {
    this.ensureConnected();

    if (this.transportType === 'sse') {
      const response = await this.client!.listTools();
      return response.tools as Tool[];
    } else {
      const response = await this.httpRequest('tools/list', {});
      return response.tools as Tool[];
    }
  }

  /**
   * Call a specific tool on the MCP server
   */
  async callTool(name: string, args: any = {}): Promise<any> {
    this.ensureConnected();

    if (this.transportType === 'sse') {
      return await this.client!.callTool({
        name,
        arguments: args,
      });
    } else {
      return await this.httpRequest('tools/call', { name, arguments: args });
    }
  }

  /**
   * List available resources from the MCP server
   */
  async listResources(): Promise<Resource[]> {
    this.ensureConnected();
    const response = await this.client.listResources();
    return response.resources as Resource[];
  }

  /**
   * Read a specific resource from the MCP server
   */
  async readResource(uri: string): Promise<any> {
    this.ensureConnected();
    const response = await this.client.readResource({ uri });
    return response;
  }

  /**
   * List available prompts from the MCP server
   */
  async listPrompts(): Promise<Prompt[]> {
    this.ensureConnected();
    const response = await this.client.listPrompts();
    return response.prompts as Prompt[];
  }

  /**
   * Get a specific prompt from the MCP server
   */
  async getPrompt(name: string, args: any = {}): Promise<any> {
    this.ensureConnected();
    const response = await this.client.getPrompt({
      name,
      arguments: args,
    });
    return response;
  }

  /**
   * Make an HTTP request to the MCP server (for HTTP transport)
   */
  private async httpRequest(method: string, params: any): Promise<any> {
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
      throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
    }
    return data.result;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('MCP client not connected. Call connect() first.');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
