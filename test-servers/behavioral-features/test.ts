#!/usr/bin/env node
/**
 * E2E tests for MCP Lifecycle Operator Behavioral Features
 *
 * This test suite validates controller-level behavioral features
 * that are not tied to specific CRD field coverage. These are
 * features introduced by specific PRs that change how the controller
 * manages resources.
 */

import {
  TestFramework,
  K8sUtils,
} from '../../framework/src/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const framework = new TestFramework('behavioral-features');
  const k8s = new K8sUtils();
  const namespace = 'default';
  const manifestsDir = path.join(__dirname, 'manifests');

  try {
    await framework.run(async (test) => {

      // ============================================================
      // B1: Default TCP readiness probe injection (PR #111)
      // ============================================================
      await test('Default TCP readiness probe injection (PR #111)', async () => {
        const serverName = 'default-tcp-readiness-probe';
        const manifestPath = path.join(manifestsDir, '01-default-tcp-readiness-probe.yaml');

        try {
          console.log(`    Testing default TCP readiness probe injection...`);
          console.log(`    When no custom readiness probe is specified, the controller should`);
          console.log(`    inject a TCP socket probe targeting spec.config.port.`);

          // Step 1: Deploy MCPServer without health probes
          console.log(`    [1/5] Deploying MCPServer without custom health probes...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=True
          console.log(`    [2/5] Waiting for Accepted=True, Valid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'True', 'Valid', namespace, 30);
          const acceptedCondition = await k8s.getMCPServerCondition(serverName, 'Accepted', namespace);
          test.assertEqual(acceptedCondition.status, 'True', 'Accepted should be True');
          test.assertEqual(acceptedCondition.reason, 'Valid', 'Accepted reason should be Valid');
          console.log(`    ✓ Accepted: status=${acceptedCondition.status}, reason=${acceptedCondition.reason}`);

          // Step 3: Wait for Ready=True
          console.log(`    [3/5] Waiting for Ready=True, Available...`);
          await k8s.waitForCondition(serverName, 'Ready', 'True', 'Available', namespace, 120);
          const readyCondition = await k8s.getMCPServerCondition(serverName, 'Ready', namespace);
          test.assertEqual(readyCondition.status, 'True', 'Ready should be True');
          test.assertEqual(readyCondition.reason, 'Available', 'Ready reason should be Available');
          console.log(`    ✓ Ready: status=${readyCondition.status}, reason=${readyCondition.reason}`);

          // Step 4: Get Deployment and inspect the readiness probe
          console.log(`    [4/5] Inspecting Deployment for injected readiness probe...`);
          const deploymentJson = await execAsync(
            `kubectl get deployment ${serverName} -n ${namespace} -o json`
          );
          const deployment = JSON.parse(deploymentJson.stdout);
          const container = deployment.spec.template.spec.containers[0];
          const readinessProbe = container.readinessProbe;

          // Verify readiness probe exists
          test.assert(
            readinessProbe !== undefined && readinessProbe !== null,
            'Readiness probe should be injected by the controller'
          );
          console.log(`    ✓ Readiness probe is present on the container`);

          // Verify it is a TCP socket probe
          test.assert(
            readinessProbe.tcpSocket !== undefined && readinessProbe.tcpSocket !== null,
            'Readiness probe should be a tcpSocket probe (not httpGet or exec)'
          );
          console.log(`    ✓ Probe type: tcpSocket`);

          // Verify the port matches spec.config.port
          const probePort = readinessProbe.tcpSocket.port;
          test.assertEqual(
            probePort,
            8080,
            `TCP socket probe port should match spec.config.port (8080), got ${probePort}`
          );
          console.log(`    ✓ Probe port: ${probePort} (matches spec.config.port)`);

          // Verify it is NOT an httpGet probe
          test.assert(
            readinessProbe.httpGet === undefined || readinessProbe.httpGet === null,
            'Readiness probe should NOT have httpGet (TCP is used because MCP only requires POST)'
          );
          console.log(`    ✓ No httpGet probe (correct: TCP used instead of HTTP GET)`);

          // Verify it is NOT an exec probe
          test.assert(
            readinessProbe.exec === undefined || readinessProbe.exec === null,
            'Readiness probe should NOT have exec'
          );
          console.log(`    ✓ No exec probe`);

          // Step 5: Log summary
          console.log(`    [5/5] Summary...`);
          console.log(`    ✓ Default TCP readiness probe correctly injected`);
          console.log(`    ✓ Probe: tcpSocket on port ${probePort}`);
          console.log(`    ✓ MCPServer reached Ready=True (MCP handshake passed)`);
        } finally {
          // Cleanup
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

    });
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }

  process.exit(framework.exitCode);
}

main();
