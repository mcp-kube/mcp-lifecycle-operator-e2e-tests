/**
 * Status Watcher - Captures all status transitions for MCPServer resources
 *
 * This utility watches a MCPServer resource and saves each unique status
 * state to a file, allowing us to capture transient states like "Initializing".
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';

export interface StatusWatcherOptions {
  serverName: string;
  namespace?: string;
  outputDir: string;
}

export class StatusWatcher {
  private process?: ChildProcess;
  private lastHash = '';
  private sequence = 0;
  private buffer = '';
  private options: Required<StatusWatcherOptions>;

  constructor(options: StatusWatcherOptions) {
    this.options = {
      namespace: 'default',
      ...options,
    };
  }

  /**
   * Start watching the MCPServer resource
   */
  async start(): Promise<void> {
    fs.mkdirSync(this.options.outputDir, { recursive: true });

    console.log(
      `    [STATUS_WATCH] Watching ${this.options.serverName} in namespace ${this.options.namespace}`
    );
    console.log(`    [STATUS_WATCH] Saving transitions to ${this.options.outputDir}`);

    // Wait for resource to be created (poll every 100ms for up to 30 seconds)
    await this.waitForResource();

    // Start kubectl watch process - use JSON output for easier parsing
    this.process = spawn(
      'kubectl',
      [
        'get',
        'mcpserver',
        this.options.serverName,
        '-n',
        this.options.namespace,
        '--watch',
        '-o',
        'json',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    // Process stdout - each line is a complete JSON object
    this.process.stdout?.on('data', (data: Buffer) => {
      // Accumulate data in buffer
      this.buffer += data.toString();

      // Try to parse complete JSON objects
      this.processBuffer();
    });

    // Log errors but don't fail
    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('No resources found') && !msg.includes('NotFound')) {
        console.log(`    [STATUS_WATCH] ${msg}`);
      }
    });

    this.process.on('exit', (code) => {
      // Suppress exit code 1 (NotFound) and 143 (SIGTERM)
      if (code !== null && code !== 0 && code !== 1 && code !== 143) {
        console.log(`    [STATUS_WATCH] Watch process exited with code ${code}`);
      }
    });
  }

  /**
   * Process buffered data and extract complete JSON objects
   */
  private processBuffer(): void {
    // Try to find complete JSON objects in the buffer
    let startIndex = 0;
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < this.buffer.length; i++) {
      const char = this.buffer[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{') {
        if (braceCount === 0) {
          startIndex = i;
        }
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          // We have a complete JSON object
          const jsonStr = this.buffer.substring(startIndex, i + 1);
          try {
            const obj = JSON.parse(jsonStr);
            this.processDocument(obj);
          } catch (error) {
            // Ignore parse errors
          }
          // Remove processed part from buffer
          this.buffer = this.buffer.substring(i + 1);
          i = -1; // Reset loop
          startIndex = 0;
        }
      }
    }
  }

  /**
   * Process a complete resource object
   */
  private processDocument(resource: any): void {
    try {
      // Extract status section
      const status = resource.status;
      if (!status) {
        return;
      }

      // Compute hash of status
      const statusStr = JSON.stringify(status, null, 2);
      const hash = crypto.createHash('sha256').update(statusStr).digest('hex');

      // If status changed, save it
      if (hash !== this.lastHash) {
        this.sequence++;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

        // Extract condition info for logging
        const conditions = status.conditions || [];
        const readyCondition = conditions.find((c: any) => c.type === 'Ready');
        const readyStatus = readyCondition?.status || 'Unknown';
        const readyReason = readyCondition?.reason || 'Unknown';

        const filename = `status-transition-${String(this.sequence).padStart(2, '0')}-${timestamp}.yaml`;
        const filepath = path.join(this.options.outputDir, filename);

        // Convert to YAML for better readability
        const yamlStr = yaml.dump(resource, { indent: 2, lineWidth: -1 });
        fs.writeFileSync(filepath, yamlStr);

        console.log(
          `    [STATUS_WATCH] Transition ${this.sequence}: Ready=${readyStatus}, reason=${readyReason}`
        );

        this.lastHash = hash;
      }
    } catch (error) {
      // Ignore processing errors
    }
  }

  /**
   * Wait for the resource to be created
   */
  private async waitForResource(): Promise<void> {
    const maxAttempts = 300; // 30 seconds
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const { stdout } = await this.execAsync(
          `kubectl get mcpserver ${this.options.serverName} -n ${this.options.namespace} --ignore-not-found -o name`
        );
        if (stdout.trim()) {
          return; // Resource exists
        }
      } catch (error) {
        // Ignore errors, keep polling
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log(`    [STATUS_WATCH] Warning: Resource not found after 30s, starting watch anyway`);
  }

  /**
   * Execute a command and return output
   */
  private execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec(command, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;
      console.log(
        `    [STATUS_WATCH] Stopped watching (captured ${this.sequence} transitions)`
      );
    }
  }
}
