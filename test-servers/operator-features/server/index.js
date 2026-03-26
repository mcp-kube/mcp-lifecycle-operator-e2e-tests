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

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// MCP JSON-RPC endpoint (configurable path)
app.post(MCP_PATH, async (req, res) => {
  const { id, method, params } = req.body;

  console.log(`MCP Request: ${method}`);

  try {
    let result;

    switch (method) {
      case 'initialize':
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
          ],
        };
        break;

      case 'tools/call':
        result = await handleToolCall(params.name, params.arguments || {});
        break;

      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }

    res.json({
      jsonrpc: '2.0',
      id,
      result,
    });
  } catch (error) {
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

async function handleToolCall(name, args) {
  switch (name) {
    case 'check_file_exists': {
      const path = args.path;
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
          } else {
            result.error = 'Path is not a file';
          }
        } else {
          result.error = 'File does not exist';
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

    case 'list_directory': {
      const path = args.path;
      const result = {
        path,
        entries: [],
        error: null,
      };

      try {
        if (!existsSync(path)) {
          result.error = 'Directory does not exist';
        } else {
          const stat = statSync(path);
          if (!stat.isDirectory()) {
            result.error = 'Path is not a directory';
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

    case 'get_env_var': {
      const varName = args.name;
      const result = {
        name: varName,
        value: process.env[varName] || null,
        exists: varName in process.env,
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
      const result = {
        argv: process.argv,
        // Skip node executable and script path, return actual arguments
        args: process.argv.slice(2),
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

    default:
      throw { code: -32000, message: `Unknown tool: ${name}` };
  }
}

app.listen(PORT, () => {
  console.log(`Operator Features Validator listening on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}${MCP_PATH}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
