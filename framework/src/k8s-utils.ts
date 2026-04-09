/**
 * Kubernetes utilities for MCP E2E tests
 * Helper functions for interacting with Kubernetes resources
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class K8sUtils {
  /**
   * Wait for an MCPServer resource to be ready
   */
  async waitForMCPServer(
    name: string,
    namespace: string = 'default',
    timeout: number = 300
  ): Promise<void> {
    const command = `kubectl wait --for=condition=Ready mcpserver/${name} -n ${namespace} --timeout=${timeout}s`;
    try {
      await execAsync(command);
    } catch (error) {
      throw new Error(
        `MCPServer ${name} not ready within ${timeout}s: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get logs from an MCPServer pod
   */
  async getMCPServerLogs(
    name: string,
    namespace: string = 'default'
  ): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `kubectl logs -l app.kubernetes.io/name=${name} -n ${namespace} --tail=-1`
      );
      return stdout;
    } catch (error) {
      throw new Error(
        `Failed to get logs for MCPServer ${name}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Delete an MCPServer resource
   */
  async deleteMCPServer(
    name: string,
    namespace: string = 'default'
  ): Promise<void> {
    try {
      await execAsync(`kubectl delete mcpserver/${name} -n ${namespace}`);
    } catch (error) {
      throw new Error(
        `Failed to delete MCPServer ${name}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get the service name for an MCPServer from its status
   */
  async getMCPServerServiceName(
    name: string,
    namespace: string = 'default'
  ): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `kubectl get mcpserver/${name} -n ${namespace} -o jsonpath='{.status.serviceName}'`
      );
      if (!stdout || stdout === '') {
        throw new Error('Service name not found in MCPServer status');
      }
      return stdout.trim().replace(/'/g, '');
    } catch (error) {
      throw new Error(
        `Failed to get service name for MCPServer ${name}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Check if a resource exists
   */
  async resourceExists(
    kind: string,
    name: string,
    namespace: string = 'default'
  ): Promise<boolean> {
    try {
      await execAsync(
        `kubectl get ${kind}/${name} -n ${namespace} --ignore-not-found`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get MCPServer status as JSON
   */
  async getMCPServerStatus(
    name: string,
    namespace: string = 'default'
  ): Promise<any> {
    try {
      const { stdout } = await execAsync(
        `kubectl get mcpserver/${name} -n ${namespace} -o jsonpath='{.status}'`
      );
      if (!stdout || stdout === '' || stdout === "''") {
        throw new Error('Status not found in MCPServer');
      }
      return JSON.parse(stdout.trim().replace(/'/g, ''));
    } catch (error) {
      throw new Error(
        `Failed to get status for MCPServer ${name}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get a specific condition from MCPServer status
   */
  async getMCPServerCondition(
    name: string,
    conditionType: string,
    namespace: string = 'default'
  ): Promise<any> {
    try {
      const status = await this.getMCPServerStatus(name, namespace);
      if (!status.conditions || !Array.isArray(status.conditions)) {
        throw new Error('No conditions found in MCPServer status');
      }
      const condition = status.conditions.find((c: any) => c.type === conditionType);
      if (!condition) {
        throw new Error(`Condition '${conditionType}' not found in MCPServer status`);
      }
      return condition;
    } catch (error) {
      throw new Error(
        `Failed to get condition '${conditionType}' for MCPServer ${name}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get the MCPServer's observedGeneration
   */
  async getMCPServerObservedGeneration(
    name: string,
    namespace: string = 'default'
  ): Promise<number> {
    try {
      const { stdout } = await execAsync(
        `kubectl get mcpserver/${name} -n ${namespace} -o jsonpath='{.status.observedGeneration}'`
      );
      if (!stdout || stdout === '' || stdout === "''") {
        throw new Error('ObservedGeneration not found in MCPServer status');
      }
      return parseInt(stdout.trim().replace(/'/g, ''), 10);
    } catch (error) {
      throw new Error(
        `Failed to get observedGeneration for MCPServer ${name}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get the MCPServer's metadata.generation
   */
  async getMCPServerGeneration(
    name: string,
    namespace: string = 'default'
  ): Promise<number> {
    try {
      const { stdout } = await execAsync(
        `kubectl get mcpserver/${name} -n ${namespace} -o jsonpath='{.metadata.generation}'`
      );
      if (!stdout || stdout === '' || stdout === "''") {
        throw new Error('Generation not found in MCPServer metadata');
      }
      return parseInt(stdout.trim().replace(/'/g, ''), 10);
    } catch (error) {
      throw new Error(
        `Failed to get generation for MCPServer ${name}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Wait for a condition to match expected values with polling
   * Polls every 1 second, returns early if match found
   * More efficient than fixed sleep times
   *
   * @param serverName - Name of the MCPServer
   * @param conditionType - Type of condition (e.g., 'Ready', 'Accepted')
   * @param expectedStatus - Expected status value (e.g., 'True', 'False', 'Unknown')
   * @param expectedReason - Expected reason value (e.g., 'Available', 'ConfigurationInvalid')
   * @param namespace - Kubernetes namespace
   * @param timeoutSec - Maximum time to wait in seconds
   * @param pollIntervalMs - Interval between polls in milliseconds (default: 1000ms)
   */
  async waitForCondition(
    serverName: string,
    conditionType: string,
    expectedStatus: string,
    expectedReason: string,
    namespace: string = 'default',
    timeoutSec: number = 60,
    pollIntervalMs: number = 1000
  ): Promise<void> {
    const startTime = Date.now();
    const timeoutMs = timeoutSec * 1000;
    let lastError: string | undefined;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const condition = await this.getMCPServerCondition(
          serverName,
          conditionType,
          namespace
        );

        if (
          condition.status === expectedStatus &&
          condition.reason === expectedReason
        ) {
          const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(
            `    ✓ Condition matched after ${elapsedSec}s ` +
            `(${conditionType}=${expectedStatus}, reason=${expectedReason})`
          );
          return;
        }

        // Condition exists but doesn't match - log current state
        lastError = `Current: ${conditionType}=${condition.status}, reason=${condition.reason}`;
      } catch (err) {
        // Condition might not exist yet, continue polling
        lastError = (err as Error).message;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Timeout waiting for ${conditionType}=${expectedStatus} ` +
      `reason=${expectedReason} after ${timeoutSec}s. ` +
      `Last state: ${lastError}`
    );
  }

  /**
   * Wait for any condition predicate to be true with polling
   * More flexible than waitForCondition - allows custom validation logic
   *
   * @param check - Async function that returns true when condition is met
   * @param description - Human-readable description of what we're waiting for
   * @param timeoutSec - Maximum time to wait in seconds
   * @param pollIntervalMs - Interval between polls in milliseconds (default: 1000ms)
   */
  async waitForPredicate(
    check: () => Promise<boolean>,
    description: string,
    timeoutSec: number = 60,
    pollIntervalMs: number = 1000
  ): Promise<void> {
    const startTime = Date.now();
    const timeoutMs = timeoutSec * 1000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        if (await check()) {
          const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`    ✓ ${description} (after ${elapsedSec}s)`);
          return;
        }
      } catch (err) {
        // Check might throw if resource doesn't exist yet, continue polling
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Timeout waiting for: ${description} (timeout: ${timeoutSec}s)`
    );
  }
}
