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
}
