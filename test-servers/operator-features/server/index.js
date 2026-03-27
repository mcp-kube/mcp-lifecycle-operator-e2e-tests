#!/usr/bin/env node
/**
 * Simple HTTP-based MCP Server for validating Kubernetes operator features.
 * Uses JSON-RPC over HTTP instead of SSE for simplicity.
 */

import express from 'express';
import fs from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { join } from 'path';

const PORT = process.env.PORT || 8080;

// Parse MCP_PATH from arguments (format: --mcp-path=/custom/path)
let MCP_PATH = '/mcp'; // default
for (const arg of process.argv) {
  if (arg.startsWith('--mcp-path=')) {
    MCP_PATH = arg.split('=')[1];
  }
}

console.log('='.repeat(60));
console.log('Operator Features Validator Starting');
console.log('='.repeat(60));
console.log(`Node version: ${process.version}`);
console.log(`Process ID: ${process.pid}`);
console.log(`Working directory: ${process.cwd()}`);
console.log(`PORT: ${PORT}`);
console.log(`MCP_PATH: ${MCP_PATH}`);
console.log(`Process arguments: ${process.argv.slice(2).join(' ')}`);
console.log(`User ID: ${process.getuid?.() || 'N/A'}`);
console.log(`Group ID: ${process.getgid?.() || 'N/A'}`);
console.log('='.repeat(60));

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  console.log('[HEALTH] Health check request received');
  res.json({ status: 'ok' });
});

// MCP JSON-RPC endpoint (configurable path)
app.post(MCP_PATH, async (req, res) => {
  const { id, method, params } = req.body;

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] MCP Request: method=${method}, id=${id}`);
  if (params && Object.keys(params).length > 0) {
    console.log(`[${timestamp}]   Params: ${JSON.stringify(params)}`);
  }

  try {
    let result;

    switch (method) {
      case 'initialize':
        console.log(`[${timestamp}] Initializing MCP server`);
        result = {
          protocolVersion: '2025-11-25',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'operator-features-validator',
            version: '1.0.0',
          },
        };
        break;

      case 'tools/list':
        console.log(`[${timestamp}] Listing available tools`);
        result = {
          tools: [
            {
              name: 'check_file_exists',
              description: 'Check if a file exists and return its content',
              inputSchema: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Absolute path to the file',
                  },
                },
                required: ['path'],
              },
            },
            {
              name: 'list_directory',
              description: 'List files in a directory',
              inputSchema: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Directory path',
                  },
                },
                required: ['path'],
              },
            },
            {
              name: 'get_env_var',
              description: 'Get environment variable value',
              inputSchema: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Variable name',
                  },
                },
                required: ['name'],
              },
            },
            {
              name: 'check_user_id',
              description: 'Get user and group IDs',
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
            {
              name: 'get_file_permissions',
              description: 'Get file permissions and ownership',
              inputSchema: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'File path',
                  },
                },
                required: ['path'],
              },
            },
            {
              name: 'get_process_arguments',
              description: 'Get process command line arguments',
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
            {
              name: 'test_directory_writable',
              description: 'Test if a directory is writable by attempting to create and delete a test file',
              inputSchema: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Directory path to test',
                  },
                },
                required: ['path'],
              },
            },
            {
              name: 'get_service_account_info',
              description: 'Get ServiceAccount information from mounted token',
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        };
        break;

      case 'tools/call':
        console.log(`[${timestamp}] Calling tool: ${params.name}`);
        result = await handleToolCall(params.name, params.arguments || {}, timestamp);
        break;

      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }

    console.log(`[${timestamp}] Response sent successfully for ${method}`);
    res.json({
      jsonrpc: '2.0',
      id,
      result,
    });
  } catch (error) {
    console.log(`[${timestamp}] Error handling ${method}: ${error.message}`);
    res.json({
      jsonrpc: '2.0',
      id,
      error: {
        code: error.code || -32000,
        message: error.message || String(error),
      },
    });
  }
});

async function handleToolCall(name, args, timestamp) {
  switch (name) {
    case 'check_file_exists': {
      const path = args.path;
      console.log(`[${timestamp}]   check_file_exists: ${path}`);
      const result = {
        exists: false,
        path,
        content: null,
        error: null,
      };

      try {
        if (existsSync(path)) {
          result.exists = true;
          const stat = statSync(path);
          if (stat.isFile()) {
            result.content = await fs.readFile(path, 'utf-8');
            console.log(`[${timestamp}]   File exists: ${path} (${result.content.length} bytes)`);
          } else {
            result.error = 'Path is not a file';
            console.log(`[${timestamp}]   Path is not a file: ${path}`);
          }
        } else {
          result.error = 'File does not exist';
          console.log(`[${timestamp}]   File does not exist: ${path}`);
        }
      } catch (error) {
        result.error = error.message;
        console.log(`[${timestamp}]   Error checking file: ${error.message}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    case 'list_directory': {
      const path = args.path;
      console.log(`[${timestamp}]   list_directory: ${path}`);
      const result = {
        path,
        entries: [],
        error: null,
      };

      try {
        if (!existsSync(path)) {
          result.error = 'Directory does not exist';
          console.log(`[${timestamp}]   Directory does not exist: ${path}`);
        } else {
          const stat = statSync(path);
          if (!stat.isDirectory()) {
            result.error = 'Path is not a directory';
            console.log(`[${timestamp}]   Path is not a directory: ${path}`);
          } else {
            const entries = await fs.readdir(path);
            for (const entry of entries) {
              const entryPath = join(path, entry);
              const entryStat = statSync(entryPath);
              result.entries.push({
                name: entry,
                type: entryStat.isDirectory() ? 'directory' : 'file',
                size: entryStat.isFile() ? entryStat.size : null,
                mode: entryStat.mode.toString(8),
              });
            }
            console.log(`[${timestamp}]   Directory contains ${entries.length} entries`);
          }
        }
      } catch (error) {
        result.error = error.message;
        console.log(`[${timestamp}]   Error listing directory: ${error.message}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    case 'get_env_var': {
      const varName = args.name;
      console.log(`[${timestamp}]   get_env_var: ${varName}`);
      const result = {
        name: varName,
        value: process.env[varName] || null,
        exists: varName in process.env,
      };
      if (result.exists) {
        console.log(`[${timestamp}]   Env var ${varName} = "${result.value}"`);
      } else {
        console.log(`[${timestamp}]   Env var ${varName} does not exist`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    case 'check_user_id': {
      const result = {
        uid: process.getuid?.() || null,
        gid: process.getgid?.() || null,
        euid: process.geteuid?.() || null,
        egid: process.getegid?.() || null,
        groups: process.getgroups?.() || [],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    case 'get_file_permissions': {
      const path = args.path;
      const result = {
        path,
        exists: false,
        permissions: null,
        error: null,
      };

      try {
        if (existsSync(path)) {
          const stat = statSync(path);
          result.exists = true;
          result.permissions = {
            mode: stat.mode.toString(8),
            uid: stat.uid,
            gid: stat.gid,
            size: stat.size,
          };
        } else {
          result.error = 'Path does not exist';
        }
      } catch (error) {
        result.error = error.message;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    case 'get_process_arguments': {
      // process.argv includes: [node, script.js, ...args]
      // We want everything after the script name
      console.log(`[${timestamp}]   get_process_arguments`);
      const result = {
        argv: process.argv,
        // Skip node executable and script path, return actual arguments
        args: process.argv.slice(2),
      };
      console.log(`[${timestamp}]   Process has ${result.args.length} arguments`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    case 'test_directory_writable': {
      const path = args.path;
      const result = {
        path,
        writable: false,
        error: null,
      };

      try {
        // Check if directory exists
        if (!existsSync(path)) {
          result.error = 'Directory does not exist';
        } else {
          const stat = statSync(path);
          if (!stat.isDirectory()) {
            result.error = 'Path is not a directory';
          } else {
            // Try to create a test file
            const testFilePath = join(path, '.write-test-' + Date.now());
            try {
              await fs.writeFile(testFilePath, 'test');
              // If write succeeded, try to delete it
              await fs.unlink(testFilePath);
              result.writable = true;
            } catch (writeError) {
              result.error = `Cannot write: ${writeError.message}`;
            }
          }
        }
      } catch (error) {
        result.error = error.message;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    case 'get_service_account_info': {
      const result = {
        namespace: null,
        tokenExists: false,
        error: null,
      };

      try {
        // Read namespace from ServiceAccount mount
        const namespacePath = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';
        if (existsSync(namespacePath)) {
          result.namespace = (await fs.readFile(namespacePath, 'utf-8')).trim();
        }

        // Check if ServiceAccount token exists (confirms custom SA is mounted)
        const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
        result.tokenExists = existsSync(tokenPath);
      } catch (error) {
        result.error = error.message;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    default:
      throw { code: -32000, message: `Unknown tool: ${name}` };
  }
}

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`✓ Server is ready and listening on port ${PORT}`);
  console.log(`✓ MCP endpoint: http://localhost:${PORT}${MCP_PATH}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log('='.repeat(60));
  console.log('Waiting for requests...');
});
