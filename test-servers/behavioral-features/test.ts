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

      // ============================================================
      // B2: MCP handshake validation - failure case (PR #111)
      // ============================================================
      await test('MCPEndpointUnavailable when handshake fails (PR #111)', async () => {
        const serverName = 'mcp-handshake-validation';
        const manifestPath = path.join(manifestsDir, '02-mcp-handshake-validation.yaml');

        try {
          console.log(`    Testing MCP handshake validation (failure case)...`);
          console.log(`    The server listens on port 8080 and serves MCP at /mcp (default),`);
          console.log(`    but config.path is set to /not-an-mcp-endpoint, so the handshake fails.`);

          // Step 1: Deploy MCPServer with wrong MCP path
          console.log(`    [1/4] Deploying MCPServer with wrong config.path...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=True (spec is valid)
          console.log(`    [2/4] Waiting for Accepted=True, Valid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'True', 'Valid', namespace, 30);
          const acceptedCondition = await k8s.getMCPServerCondition(serverName, 'Accepted', namespace);
          test.assertEqual(acceptedCondition.status, 'True', 'Accepted should be True');
          test.assertEqual(acceptedCondition.reason, 'Valid', 'Accepted reason should be Valid');
          console.log(`    ✓ Accepted: status=${acceptedCondition.status}, reason=${acceptedCondition.reason}`);

          // Step 3: Wait for Ready=False, MCPEndpointUnavailable
          // The deployment will become Available (TCP probe passes on port 8080),
          // then the controller attempts the MCP handshake at /not-an-mcp-endpoint,
          // which fails because the server only serves MCP at /mcp.
          console.log(`    [3/4] Waiting for Ready=False, MCPEndpointUnavailable...`);
          console.log(`    (Deployment must become Available first, then handshake fails)`);
          await k8s.waitForCondition(serverName, 'Ready', 'False', 'MCPEndpointUnavailable', namespace, 120);
          const readyCondition = await k8s.getMCPServerCondition(serverName, 'Ready', namespace);
          test.assertEqual(readyCondition.status, 'False', 'Ready should be False');
          test.assertEqual(readyCondition.reason, 'MCPEndpointUnavailable', 'Ready reason should be MCPEndpointUnavailable');
          console.log(`    ✓ Ready: status=${readyCondition.status}, reason=${readyCondition.reason}`);

          // Step 4: Verify condition message
          console.log(`    [4/4] Verifying condition message...`);
          test.assert(
            readyCondition.message?.includes('MCP endpoint is not serving a valid MCP protocol'),
            `Ready message should mention MCP protocol failure, got: "${readyCondition.message}"`
          );
          console.log(`    ✓ Message: "${readyCondition.message}"`);
          console.log(`    ✓ MCP handshake correctly failed for wrong path`);
        } finally {
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // B2: MCP handshake validation - recovery case (PR #111)
      // ============================================================
      await test('Recovery from MCPEndpointUnavailable by fixing path (PR #111)', async () => {
        const serverName = 'mcp-handshake-validation';
        const manifestPath = path.join(manifestsDir, '02-mcp-handshake-validation.yaml');

        try {
          console.log(`    Testing MCP handshake recovery...`);
          console.log(`    Deploy with wrong path (MCPEndpointUnavailable), then fix path to recover.`);

          // Step 1: Deploy MCPServer with wrong MCP path
          console.log(`    [1/5] Deploying MCPServer with wrong config.path...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for MCPEndpointUnavailable
          console.log(`    [2/5] Waiting for Ready=False, MCPEndpointUnavailable...`);
          await k8s.waitForCondition(serverName, 'Ready', 'False', 'MCPEndpointUnavailable', namespace, 120);
          const initialReady = await k8s.getMCPServerCondition(serverName, 'Ready', namespace);
          console.log(`    ✓ Initial Ready: status=${initialReady.status}, reason=${initialReady.reason}`);

          // Step 3: Fix the path to /mcp (where the server actually serves MCP)
          console.log(`    [3/5] Patching config.path to /mcp (correct path)...`);
          await execAsync(
            `kubectl patch mcpserver ${serverName} -n ${namespace} --type=merge -p '{"spec":{"config":{"path":"/mcp"}}}'`
          );

          // Step 4: Wait for Ready=True, Available
          console.log(`    [4/5] Waiting for Ready=True, Available (recovery)...`);
          await k8s.waitForCondition(serverName, 'Ready', 'True', 'Available', namespace, 120);
          const recoveredReady = await k8s.getMCPServerCondition(serverName, 'Ready', namespace);
          test.assertEqual(recoveredReady.status, 'True', 'Ready should be True after fixing path');
          test.assertEqual(recoveredReady.reason, 'Available', 'Ready reason should be Available');
          console.log(`    ✓ Recovered Ready: status=${recoveredReady.status}, reason=${recoveredReady.reason}`);

          // Step 5: Verify generation advanced
          console.log(`    [5/5] Verifying generation advanced...`);
          const serverJson = await execAsync(`kubectl get mcpserver ${serverName} -n ${namespace} -o json`);
          const server = JSON.parse(serverJson.stdout);
          const generation = server.metadata.generation;
          const observedGeneration = server.status.observedGeneration;
          test.assert(generation >= 2, `Generation should be >= 2 after patch, got ${generation}`);
          test.assertEqual(observedGeneration, generation, `observedGeneration should match generation`);
          console.log(`    ✓ Generation: ${generation}, observedGeneration: ${observedGeneration}`);
          console.log(`    ✓ Recovery successful: MCPEndpointUnavailable → Available`);
        } finally {
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // B3: Config-hash rolling update on ConfigMap change (PR #140)
      // ============================================================
      await test('Config-hash rolling update on ConfigMap change (PR #140)', async () => {
        const serverName = 'config-hash-rolling-update';
        const configMapName = 'config-hash-test-configmap';
        const manifestPath = path.join(manifestsDir, '03-config-hash-rolling-update.yaml');

        try {
          console.log(`    Testing config-hash rolling update...`);
          console.log(`    When referenced ConfigMap data changes, the controller recomputes`);
          console.log(`    the config-hash annotation and Kubernetes performs a rolling update.`);

          // Step 1: Deploy ConfigMap + MCPServer
          console.log(`    [1/7] Deploying ConfigMap and MCPServer...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Ready=True, Available
          console.log(`    [2/7] Waiting for Ready=True, Available...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'True', 'Valid', namespace, 30);
          await k8s.waitForCondition(serverName, 'Ready', 'True', 'Available', namespace, 120);
          console.log(`    ✓ MCPServer is ready`);

          // Step 3: Record initial config-hash and pod names
          console.log(`    [3/7] Recording initial state...`);
          const initialDeploymentJson = await execAsync(
            `kubectl get deployment ${serverName} -n ${namespace} -o json`
          );
          const initialDeployment = JSON.parse(initialDeploymentJson.stdout);
          const initialConfigHash = initialDeployment.spec?.template?.metadata?.annotations?.['mcp.x-k8s.io/config-hash'] || '';

          test.assert(
            initialConfigHash.length > 0,
            'Config-hash annotation should be non-empty when ConfigMap is referenced'
          );
          console.log(`    ✓ Initial config-hash: ${initialConfigHash.substring(0, 16)}...`);

          const { stdout: initialPodsRaw } = await execAsync(
            `kubectl get pods -n ${namespace} -l mcp-server=${serverName} -o jsonpath='{.items[*].metadata.name}'`
          );
          const initialPodNames = initialPodsRaw.trim().split(/\s+/).filter(Boolean);
          console.log(`    ✓ Initial pods: ${initialPodNames.join(', ')}`);

          // Step 4: Update ConfigMap data
          console.log(`    [4/7] Updating ConfigMap data...`);
          await execAsync(
            `kubectl patch configmap ${configMapName} -n ${namespace} --type=merge -p '{"data":{"config.txt":"updated-data"}}'`
          );
          console.log(`    ✓ ConfigMap patched`);

          // Step 5: Wait for Ready=True, Available (after rolling update + MCP handshake)
          console.log(`    [5/7] Waiting for rolling update to complete and Ready=True...`);
          // Give time for the watch to trigger, config-hash to recompute, and rolling update to proceed
          await sleep(5000);
          await k8s.waitForCondition(serverName, 'Ready', 'True', 'Available', namespace, 120);
          console.log(`    ✓ MCPServer is ready after rolling update`);

          // Step 6: Verify config-hash changed
          console.log(`    [6/7] Verifying config-hash changed...`);
          const finalDeploymentJson = await execAsync(
            `kubectl get deployment ${serverName} -n ${namespace} -o json`
          );
          const finalDeployment = JSON.parse(finalDeploymentJson.stdout);
          const finalConfigHash = finalDeployment.spec?.template?.metadata?.annotations?.['mcp.x-k8s.io/config-hash'] || '';

          test.assert(
            finalConfigHash.length > 0,
            'Config-hash annotation should still be non-empty'
          );
          test.assert(
            initialConfigHash !== finalConfigHash,
            `Config-hash should change (was ${initialConfigHash.substring(0, 16)}..., now ${finalConfigHash.substring(0, 16)}...)`
          );
          console.log(`    ✓ Config-hash changed: ${initialConfigHash.substring(0, 16)}... → ${finalConfigHash.substring(0, 16)}...`);

          // Step 7: Verify pods were rolled
          console.log(`    [7/7] Verifying pods were rolled...`);
          const { stdout: finalPodsRaw } = await execAsync(
            `kubectl get pods -n ${namespace} -l mcp-server=${serverName} -o jsonpath='{.items[*].metadata.name}'`
          );
          const finalPodNames = finalPodsRaw.trim().split(/\s+/).filter(Boolean);
          const podsChanged = !initialPodNames.every(name => finalPodNames.includes(name));

          test.assert(
            podsChanged,
            `Pods should have been rolled (initial: ${initialPodNames.join(', ')}, final: ${finalPodNames.join(', ')})`
          );
          console.log(`    ✓ Pods rolled: ${initialPodNames.join(', ')} → ${finalPodNames.join(', ')}`);
          console.log(`    ✓ Config-hash rolling update verified successfully`);
        } finally {
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await execAsync(`kubectl delete configmap ${configMapName} -n ${namespace} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // B4: Event recording - Normal event on valid config (PR #118)
      // ============================================================
      await test('Normal event emitted on valid configuration (PR #118)', async () => {
        const serverName = 'event-recording-valid';
        const manifestPath = path.join(manifestsDir, '04-event-recording-valid.yaml');

        try {
          console.log(`    Testing Normal event emission on valid configuration...`);
          console.log(`    The controller should emit a Normal event when Accepted transitions to True.`);

          // Step 1: Deploy valid MCPServer
          console.log(`    [1/3] Deploying valid MCPServer...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=True
          console.log(`    [2/3] Waiting for Accepted=True, Valid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'True', 'Valid', namespace, 30);
          console.log(`    ✓ Accepted: True, Valid`);

          // Give a moment for the event to be persisted
          await sleep(2000);

          // Step 3: Query events and verify Normal event exists
          console.log(`    [3/3] Querying events for Normal event...`);
          const { stdout: eventsJson } = await execAsync(
            `kubectl get events.v1.events.k8s.io -n ${namespace} -o json`
          );
          const allEvents = JSON.parse(eventsJson);
          const mcpEvents = allEvents.items.filter((e: any) =>
            e.regarding?.name === serverName &&
            e.reportingController === 'mcpserver-controller'
          );
          console.log(`    Found ${mcpEvents.length} event(s) from mcpserver-controller for ${serverName}`);

          const normalEvents = mcpEvents.filter((e: any) =>
            e.type === 'Normal' && e.reason === 'Valid'
          );

          test.assert(
            normalEvents.length > 0,
            `Should have at least one Normal event with reason "Valid" (found ${mcpEvents.length} total events)`
          );

          const normalEvent = normalEvents[0];
          test.assert(
            normalEvent.note?.includes('Accepted=True'),
            `Normal event note should mention Accepted=True, got: "${normalEvent.note}"`
          );
          console.log(`    ✓ Normal event: reason=${normalEvent.reason}, action=${normalEvent.action}, note="${normalEvent.note}"`);
          console.log(`    ✓ Controller correctly emitted Normal event on Accepted=True`);
        } finally {
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // B4: Event recording - Warning event on invalid config (PR #118)
      // ============================================================
      await test('Warning event emitted on invalid configuration (PR #118)', async () => {
        const serverName = 'event-recording-invalid';
        const manifestPath = path.join(manifestsDir, '04-event-recording-invalid.yaml');
        const missingConfigMapName = 'this-configmap-does-not-exist-for-events';

        try {
          console.log(`    Testing Warning event emission on invalid configuration...`);
          console.log(`    The controller should emit a Warning event on permanent validation failure.`);

          // Step 1: Deploy MCPServer referencing non-existent ConfigMap
          console.log(`    [1/3] Deploying MCPServer with missing ConfigMap reference...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=False, Invalid
          console.log(`    [2/3] Waiting for Accepted=False, Invalid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'False', 'Invalid', namespace, 30);
          console.log(`    ✓ Accepted: False, Invalid`);

          // Give a moment for the event to be persisted
          await sleep(2000);

          // Step 3: Query events and verify Warning event exists
          console.log(`    [3/3] Querying events for Warning event...`);
          const { stdout: eventsJson } = await execAsync(
            `kubectl get events.v1.events.k8s.io -n ${namespace} -o json`
          );
          const allEvents = JSON.parse(eventsJson);
          const mcpEvents = allEvents.items.filter((e: any) =>
            e.regarding?.name === serverName &&
            e.reportingController === 'mcpserver-controller'
          );
          console.log(`    Found ${mcpEvents.length} event(s) from mcpserver-controller for ${serverName}`);

          const warningEvents = mcpEvents.filter((e: any) =>
            e.type === 'Warning' && e.reason === 'Invalid'
          );

          test.assert(
            warningEvents.length > 0,
            `Should have at least one Warning event with reason "Invalid" (found ${mcpEvents.length} total events)`
          );

          const warningEvent = warningEvents[0];
          test.assert(
            warningEvent.note?.includes(missingConfigMapName),
            `Warning event note should mention missing ConfigMap "${missingConfigMapName}", got: "${warningEvent.note}"`
          );
          console.log(`    ✓ Warning event: reason=${warningEvent.reason}, action=${warningEvent.action}, note="${warningEvent.note}"`);
          console.log(`    ✓ Controller correctly emitted Warning event on validation failure`);
        } finally {
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
