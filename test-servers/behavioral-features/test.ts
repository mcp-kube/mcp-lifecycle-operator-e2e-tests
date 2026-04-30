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

          // Step 5: Wait for rolling update to fully complete
          console.log(`    [5/7] Waiting for rolling update to complete...`);
          // Give time for the watch to trigger and config-hash to recompute
          await sleep(5000);
          // Wait for deployment rollout to finish (old pods terminated, new pods ready)
          await execAsync(
            `kubectl rollout status deployment/${serverName} -n ${namespace} --timeout=120s`
          );
          await k8s.waitForCondition(serverName, 'Ready', 'True', 'Available', namespace, 120);
          console.log(`    ✓ Rolling update complete, MCPServer is ready`);

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
          // Use --field-selector to exclude Terminating pods (old pods may still be shutting down)
          const { stdout: finalPodsRaw } = await execAsync(
            `kubectl get pods -n ${namespace} -l mcp-server=${serverName} --field-selector=status.phase=Running -o jsonpath='{.items[*].metadata.name}'`
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

      // ============================================================
      // B5: Custom Prometheus metrics verification (PR #122)
      // ============================================================
      await test('Custom Prometheus metrics are exposed (PR #122)', async () => {
        const validServerName = 'metrics-test-valid';
        const invalidServerName = 'metrics-test-invalid';
        const validManifestPath = path.join(manifestsDir, '05-metrics-valid.yaml');
        const invalidManifestPath = path.join(manifestsDir, '05-metrics-invalid.yaml');
        const operatorNamespace = 'mcp-lifecycle-operator-system';
        const metricsService = 'mcp-lifecycle-operator-controller-manager-metrics-service';
        const serviceAccount = 'mcp-lifecycle-operator-controller-manager';
        const bindingName = 'metrics-e2e-test-binding';
        const localPort = 9443;
        let pfProcess: any = null;

        try {
          console.log(`    Testing custom Prometheus metrics...`);
          console.log(`    The controller should expose mcpserver_* metrics via /metrics endpoint.`);

          // Step 1: Deploy valid and invalid MCPServers
          console.log(`    [1/6] Deploying valid and invalid MCPServers...`);
          await execAsync(`kubectl apply -f ${validManifestPath}`);
          await execAsync(`kubectl apply -f ${invalidManifestPath}`);

          // Step 2: Wait for expected conditions
          console.log(`    [2/6] Waiting for expected conditions...`);
          await k8s.waitForCondition(validServerName, 'Ready', 'True', 'Available', namespace, 120);
          console.log(`    ✓ ${validServerName}: Ready=True, Available`);
          await k8s.waitForCondition(invalidServerName, 'Accepted', 'False', 'Invalid', namespace, 30);
          console.log(`    ✓ ${invalidServerName}: Accepted=False, Invalid`);

          // Step 3: Set up metrics access
          console.log(`    [3/6] Setting up metrics access (RBAC, token, port-forward)...`);
          await execAsync(
            `kubectl create clusterrolebinding ${bindingName} ` +
            `--clusterrole=mcp-lifecycle-operator-metrics-reader ` +
            `--serviceaccount=${operatorNamespace}:${serviceAccount}`
          );
          const { stdout: tokenRaw } = await execAsync(
            `kubectl create token ${serviceAccount} -n ${operatorNamespace}`
          );
          const token = tokenRaw.trim();

          pfProcess = exec(
            `kubectl port-forward svc/${metricsService} ${localPort}:8443 -n ${operatorNamespace}`
          );
          await sleep(3000);
          console.log(`    ✓ Metrics access configured`);

          // Step 4: Fetch metrics
          console.log(`    [4/6] Fetching metrics from operator...`);
          const { stdout: metricsRaw } = await execAsync(
            `curl -sk -H "Authorization: Bearer ${token}" https://localhost:${localPort}/metrics`
          );
          const metricsLines = metricsRaw.split('\n');
          const mcpMetrics = metricsLines.filter((line: string) => line.startsWith('mcpserver_'));
          console.log(`    ✓ Fetched ${metricsLines.length} total lines, ${mcpMetrics.length} mcpserver_* metrics`);

          // Step 5: Verify condition_info metrics
          console.log(`    [5/6] Verifying mcpserver_condition_info metrics...`);

          // Valid server: Accepted=True,Valid
          const validAccepted = mcpMetrics.find((line: string) =>
            line.startsWith('mcpserver_condition_info') &&
            line.includes(`name="${validServerName}"`) &&
            line.includes('type="Accepted"') &&
            line.includes('status="True"') &&
            line.includes('reason="Valid"')
          );
          test.assert(
            validAccepted !== undefined,
            `Should have condition_info for ${validServerName} Accepted=True,Valid`
          );
          console.log(`    ✓ condition_info: ${validServerName} Accepted=True, Valid`);

          // Valid server: Ready=True,Available
          const validReady = mcpMetrics.find((line: string) =>
            line.startsWith('mcpserver_condition_info') &&
            line.includes(`name="${validServerName}"`) &&
            line.includes('type="Ready"') &&
            line.includes('status="True"') &&
            line.includes('reason="Available"')
          );
          test.assert(
            validReady !== undefined,
            `Should have condition_info for ${validServerName} Ready=True,Available`
          );
          console.log(`    ✓ condition_info: ${validServerName} Ready=True, Available`);

          // Invalid server: Accepted=False,Invalid
          const invalidAccepted = mcpMetrics.find((line: string) =>
            line.startsWith('mcpserver_condition_info') &&
            line.includes(`name="${invalidServerName}"`) &&
            line.includes('type="Accepted"') &&
            line.includes('status="False"') &&
            line.includes('reason="Invalid"')
          );
          test.assert(
            invalidAccepted !== undefined,
            `Should have condition_info for ${invalidServerName} Accepted=False,Invalid`
          );
          console.log(`    ✓ condition_info: ${invalidServerName} Accepted=False, Invalid`);

          // Step 6: Verify other metrics exist
          console.log(`    [6/6] Verifying other custom metrics...`);

          // validation_failures_total for invalid server
          const validationFailures = mcpMetrics.find((line: string) =>
            line.startsWith('mcpserver_validation_failures_total') &&
            line.includes(`name="${invalidServerName}"`)
          );
          test.assert(
            validationFailures !== undefined,
            `Should have validation_failures_total for ${invalidServerName}`
          );
          console.log(`    ✓ validation_failures_total: ${validationFailures?.trim()}`);

          // reconcile_phase_duration_seconds histogram exists
          const phaseDuration = mcpMetrics.find((line: string) =>
            line.startsWith('mcpserver_reconcile_phase_duration_seconds_count') &&
            line.includes('phase="validation"')
          );
          test.assert(
            phaseDuration !== undefined,
            'Should have reconcile_phase_duration_seconds for validation phase'
          );
          console.log(`    ✓ reconcile_phase_duration_seconds: validation phase present`);

          console.log(`    ✓ All custom Prometheus metrics verified`);
        } finally {
          // Kill port-forward
          if (pfProcess) {
            pfProcess.kill();
          }
          // Cleanup
          console.log(`    Cleaning up metrics test resources...`);
          await execAsync(`kubectl delete -f ${validManifestPath} --ignore-not-found=true`);
          await execAsync(`kubectl delete -f ${invalidManifestPath} --ignore-not-found=true`);
          await execAsync(`kubectl delete clusterrolebinding ${bindingName} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // B6: Env valueFrom validation - missing Secret (PR #103)
      // ============================================================
      await test('Accepted=False when env valueFrom references missing Secret (PR #103)', async () => {
        const serverName = 'env-valuefrom-missing-secret';
        const manifestPath = path.join(manifestsDir, '06-env-valuefrom-missing-secret.yaml');
        const missingSecretName = 'this-secret-does-not-exist-for-valuefrom';

        try {
          console.log(`    Testing env valueFrom validation with missing Secret...`);
          console.log(`    env[].valueFrom.secretKeyRef referencing a non-existent Secret`);
          console.log(`    should cause Accepted=False, Invalid.`);

          // Step 1: Deploy MCPServer with missing secret reference
          console.log(`    [1/3] Deploying MCPServer with missing secretKeyRef...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=False, Invalid
          console.log(`    [2/3] Waiting for Accepted=False, Invalid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'False', 'Invalid', namespace, 30);
          const acceptedCondition = await k8s.getMCPServerCondition(serverName, 'Accepted', namespace);
          test.assertEqual(acceptedCondition.status, 'False', 'Accepted should be False');
          test.assertEqual(acceptedCondition.reason, 'Invalid', 'Accepted reason should be Invalid');
          console.log(`    ✓ Accepted: status=${acceptedCondition.status}, reason=${acceptedCondition.reason}`);

          // Step 3: Verify condition message mentions the secret and env var
          console.log(`    [3/3] Verifying condition message...`);
          test.assert(
            acceptedCondition.message?.includes(missingSecretName),
            `Accepted message should mention missing Secret "${missingSecretName}", got: "${acceptedCondition.message}"`
          );
          test.assert(
            acceptedCondition.message?.toLowerCase().includes('env'),
            `Accepted message should mention "env", got: "${acceptedCondition.message}"`
          );
          console.log(`    ✓ Message: "${acceptedCondition.message}"`);
          console.log(`    ✓ Correctly rejected: missing Secret via env valueFrom`);
        } finally {
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // B6: Env valueFrom validation - missing ConfigMap (PR #103)
      // ============================================================
      await test('Accepted=False when env valueFrom references missing ConfigMap (PR #103)', async () => {
        const serverName = 'env-valuefrom-missing-configmap';
        const manifestPath = path.join(manifestsDir, '06-env-valuefrom-missing-configmap.yaml');
        const missingConfigMapName = 'this-configmap-does-not-exist-for-valuefrom';

        try {
          console.log(`    Testing env valueFrom validation with missing ConfigMap...`);
          console.log(`    env[].valueFrom.configMapKeyRef referencing a non-existent ConfigMap`);
          console.log(`    should cause Accepted=False, Invalid.`);

          // Step 1: Deploy MCPServer with missing configmap reference
          console.log(`    [1/3] Deploying MCPServer with missing configMapKeyRef...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=False, Invalid
          console.log(`    [2/3] Waiting for Accepted=False, Invalid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'False', 'Invalid', namespace, 30);
          const acceptedCondition = await k8s.getMCPServerCondition(serverName, 'Accepted', namespace);
          test.assertEqual(acceptedCondition.status, 'False', 'Accepted should be False');
          test.assertEqual(acceptedCondition.reason, 'Invalid', 'Accepted reason should be Invalid');
          console.log(`    ✓ Accepted: status=${acceptedCondition.status}, reason=${acceptedCondition.reason}`);

          // Step 3: Verify condition message mentions the configmap and env var
          console.log(`    [3/3] Verifying condition message...`);
          test.assert(
            acceptedCondition.message?.includes(missingConfigMapName),
            `Accepted message should mention missing ConfigMap "${missingConfigMapName}", got: "${acceptedCondition.message}"`
          );
          test.assert(
            acceptedCondition.message?.toLowerCase().includes('env'),
            `Accepted message should mention "env", got: "${acceptedCondition.message}"`
          );
          console.log(`    ✓ Message: "${acceptedCondition.message}"`);
          console.log(`    ✓ Correctly rejected: missing ConfigMap via env valueFrom`);
        } finally {
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // B6: Env valueFrom validation - optional secretKeyRef (PR #103)
      // ============================================================
      await test('Accepted=True when env valueFrom uses optional secretKeyRef (PR #103)', async () => {
        const serverName = 'env-valuefrom-optional-secret';
        const manifestPath = path.join(manifestsDir, '06-env-valuefrom-optional-secret.yaml');

        try {
          console.log(`    Testing env valueFrom validation with optional secretKeyRef...`);
          console.log(`    env[].valueFrom.secretKeyRef with optional: true referencing a`);
          console.log(`    non-existent Secret should still pass validation (Accepted=True).`);

          // Step 1: Deploy MCPServer with optional missing secret reference
          console.log(`    [1/2] Deploying MCPServer with optional secretKeyRef...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=True, Valid
          console.log(`    [2/2] Waiting for Accepted=True, Valid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'True', 'Valid', namespace, 30);
          const acceptedCondition = await k8s.getMCPServerCondition(serverName, 'Accepted', namespace);
          test.assertEqual(acceptedCondition.status, 'True', 'Accepted should be True');
          test.assertEqual(acceptedCondition.reason, 'Valid', 'Accepted reason should be Valid');
          console.log(`    ✓ Accepted: status=${acceptedCondition.status}, reason=${acceptedCondition.reason}`);
          console.log(`    ✓ Correctly accepted: optional secretKeyRef skips validation`);
        } finally {
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // CRD Field #5: RecursiveReadOnly storage permission
      // ============================================================
      await test('RecursiveReadOnly storage permission sets recursiveReadOnly on volume mount', async () => {
        const serverName = 'recursive-readonly-storage';
        const configMapName = 'configmap-for-recursive-readonly';
        const manifestPath = path.join(manifestsDir, '07-recursive-readonly-storage.yaml');

        try {
          console.log(`    Testing RecursiveReadOnly storage permission...`);
          console.log(`    permissions: RecursiveReadOnly should produce a volume mount`);
          console.log(`    with readOnly: true and recursiveReadOnly: Enabled.`);

          // Step 1: Deploy ConfigMap + MCPServer
          console.log(`    [1/4] Deploying ConfigMap and MCPServer...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=True
          console.log(`    [2/4] Waiting for Accepted=True, Valid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'True', 'Valid', namespace, 30);
          console.log(`    ✓ Accepted: True, Valid`);

          // Step 3: Wait for Ready=True
          console.log(`    [3/4] Waiting for Ready=True, Available...`);
          await k8s.waitForCondition(serverName, 'Ready', 'True', 'Available', namespace, 120);
          console.log(`    ✓ Ready: True, Available`);

          // Step 4: Inspect Deployment for volume mount configuration
          console.log(`    [4/4] Inspecting Deployment for recursiveReadOnly on volume mount...`);
          const { stdout: deploymentRaw } = await execAsync(
            `kubectl get deployment ${serverName} -n ${namespace} -o json`
          );
          const deployment = JSON.parse(deploymentRaw);
          const container = deployment.spec.template.spec.containers[0];

          // Find the volume mount for /recursive-readonly-mount
          const mount = container.volumeMounts?.find(
            (vm: any) => vm.mountPath === '/recursive-readonly-mount'
          );
          test.assert(mount !== undefined, 'Should have a volume mount at /recursive-readonly-mount');
          console.log(`    ✓ Volume mount found: mountPath=${mount.mountPath}`);

          // Verify readOnly: true
          test.assert(mount.readOnly === true, `Volume mount should have readOnly: true, got ${mount.readOnly}`);
          console.log(`    ✓ readOnly: ${mount.readOnly}`);

          // Verify recursiveReadOnly: Enabled
          test.assertEqual(
            mount.recursiveReadOnly,
            'Enabled',
            `Volume mount should have recursiveReadOnly: Enabled, got ${mount.recursiveReadOnly}`
          );
          console.log(`    ✓ recursiveReadOnly: ${mount.recursiveReadOnly}`);
          console.log(`    ✓ RecursiveReadOnly storage permission verified successfully`);
        } finally {
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await execAsync(`kubectl delete configmap ${configMapName} -n ${namespace} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // CRD Field #6: Exec health probe type
      // ============================================================
      await test('Exec health probes are configured correctly', async () => {
        const serverName = 'exec-health-probe';
        const manifestPath = path.join(manifestsDir, '08-exec-health-probe.yaml');

        try {
          console.log(`    Testing exec health probe type...`);
          console.log(`    The validator server creates /tmp/server-ready on startup,`);
          console.log(`    so exec probes using "cat /tmp/server-ready" should pass.`);

          // Step 1: Deploy MCPServer with exec probes
          console.log(`    [1/4] Deploying MCPServer with exec probes...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=True
          console.log(`    [2/4] Waiting for Accepted=True, Valid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'True', 'Valid', namespace, 30);
          console.log(`    ✓ Accepted: True, Valid`);

          // Step 3: Wait for Ready=True (proves exec probe passes at runtime)
          console.log(`    [3/4] Waiting for Ready=True, Available...`);
          await k8s.waitForCondition(serverName, 'Ready', 'True', 'Available', namespace, 120);
          console.log(`    ✓ Ready: True, Available`);

          // Step 4: Inspect Deployment for exec probes
          console.log(`    [4/4] Inspecting Deployment for exec probes...`);
          const { stdout: deploymentRaw } = await execAsync(
            `kubectl get deployment ${serverName} -n ${namespace} -o json`
          );
          const deployment = JSON.parse(deploymentRaw);
          const container = deployment.spec.template.spec.containers[0];

          // Verify readiness probe is exec type
          const readinessProbe = container.readinessProbe;
          test.assert(readinessProbe !== undefined, 'Readiness probe should exist');
          test.assert(readinessProbe.exec !== undefined, 'Readiness probe should be exec type');
          test.assert(readinessProbe.httpGet === undefined, 'Readiness probe should NOT have httpGet');
          test.assert(readinessProbe.tcpSocket === undefined, 'Readiness probe should NOT have tcpSocket');
          test.assertDeepEqual(
            readinessProbe.exec.command,
            ['cat', '/tmp/server-ready'],
            'Readiness probe command should be ["cat", "/tmp/server-ready"]'
          );
          console.log(`    ✓ Readiness probe: exec command=${JSON.stringify(readinessProbe.exec.command)}`);

          // Verify liveness probe is exec type
          const livenessProbe = container.livenessProbe;
          test.assert(livenessProbe !== undefined, 'Liveness probe should exist');
          test.assert(livenessProbe.exec !== undefined, 'Liveness probe should be exec type');
          test.assertDeepEqual(
            livenessProbe.exec.command,
            ['cat', '/tmp/server-ready'],
            'Liveness probe command should be ["cat", "/tmp/server-ready"]'
          );
          console.log(`    ✓ Liveness probe: exec command=${JSON.stringify(livenessProbe.exec.command)}`);

          // Verify probe timing parameters were passed through
          test.assertEqual(readinessProbe.initialDelaySeconds, 3, 'Readiness initialDelaySeconds should be 3');
          test.assertEqual(readinessProbe.periodSeconds, 5, 'Readiness periodSeconds should be 5');
          test.assertEqual(livenessProbe.initialDelaySeconds, 5, 'Liveness initialDelaySeconds should be 5');
          test.assertEqual(livenessProbe.periodSeconds, 10, 'Liveness periodSeconds should be 10');
          console.log(`    ✓ Probe timing parameters verified`);
          console.log(`    ✓ Exec health probes verified successfully`);
          console.log(`    (Ready=True proves the exec probe passes at runtime)`);
        } finally {
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // CRD Field #7: Explicit tcpSocket health probe type
      // ============================================================
      await test('Explicit tcpSocket health probes are configured correctly', async () => {
        const serverName = 'explicit-tcp-health-probe';
        const manifestPath = path.join(manifestsDir, '09-explicit-tcp-health-probe.yaml');

        try {
          console.log(`    Testing explicit tcpSocket health probe type...`);
          console.log(`    This tests EXPLICIT tcpSocket configuration (not auto-injected).`);
          console.log(`    Different from B1: here the user specifies tcpSocket probes directly.`);

          // Step 1: Deploy MCPServer with explicit tcpSocket probes
          console.log(`    [1/4] Deploying MCPServer with explicit tcpSocket probes...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=True
          console.log(`    [2/4] Waiting for Accepted=True, Valid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'True', 'Valid', namespace, 30);
          console.log(`    ✓ Accepted: True, Valid`);

          // Step 3: Wait for Ready=True
          console.log(`    [3/4] Waiting for Ready=True, Available...`);
          await k8s.waitForCondition(serverName, 'Ready', 'True', 'Available', namespace, 120);
          console.log(`    ✓ Ready: True, Available`);

          // Step 4: Inspect Deployment for tcpSocket probes
          console.log(`    [4/4] Inspecting Deployment for tcpSocket probes...`);
          const { stdout: deploymentRaw } = await execAsync(
            `kubectl get deployment ${serverName} -n ${namespace} -o json`
          );
          const deployment = JSON.parse(deploymentRaw);
          const container = deployment.spec.template.spec.containers[0];

          // Verify readiness probe is tcpSocket type
          const readinessProbe = container.readinessProbe;
          test.assert(readinessProbe !== undefined, 'Readiness probe should exist');
          test.assert(readinessProbe.tcpSocket !== undefined, 'Readiness probe should be tcpSocket type');
          test.assert(readinessProbe.httpGet === undefined, 'Readiness probe should NOT have httpGet');
          test.assert(readinessProbe.exec === undefined, 'Readiness probe should NOT have exec');
          test.assertEqual(
            readinessProbe.tcpSocket.port,
            8080,
            `Readiness probe tcpSocket port should be 8080, got ${readinessProbe.tcpSocket.port}`
          );
          console.log(`    ✓ Readiness probe: tcpSocket port=${readinessProbe.tcpSocket.port}`);

          // Verify liveness probe is tcpSocket type
          const livenessProbe = container.livenessProbe;
          test.assert(livenessProbe !== undefined, 'Liveness probe should exist');
          test.assert(livenessProbe.tcpSocket !== undefined, 'Liveness probe should be tcpSocket type');
          test.assertEqual(
            livenessProbe.tcpSocket.port,
            8080,
            `Liveness probe tcpSocket port should be 8080, got ${livenessProbe.tcpSocket.port}`
          );
          console.log(`    ✓ Liveness probe: tcpSocket port=${livenessProbe.tcpSocket.port}`);

          // Verify probe timing parameters
          test.assertEqual(readinessProbe.initialDelaySeconds, 3, 'Readiness initialDelaySeconds should be 3');
          test.assertEqual(readinessProbe.periodSeconds, 5, 'Readiness periodSeconds should be 5');
          test.assertEqual(livenessProbe.initialDelaySeconds, 5, 'Liveness initialDelaySeconds should be 5');
          test.assertEqual(livenessProbe.periodSeconds, 10, 'Liveness periodSeconds should be 10');
          console.log(`    ✓ Probe timing parameters verified`);
          console.log(`    ✓ Explicit tcpSocket health probes verified successfully`);
          console.log(`    (Ready=True proves the tcpSocket probes pass at runtime)`);
        } finally {
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // ============================================================
      // CRD Field #8: Container-level security context overrides
      // ============================================================
      await test('Container-level security context overrides pod-level values', async () => {
        const serverName = 'container-security-override';
        const manifestPath = path.join(manifestsDir, '10-container-security-override.yaml');

        try {
          console.log(`    Testing container-level security context overrides...`);
          console.log(`    Pod-level: runAsUser=1000, runAsGroup=3000`);
          console.log(`    Container-level: runAsUser=2000, runAsGroup=4000`);
          console.log(`    Container-level should override pod-level.`);

          // Step 1: Deploy MCPServer
          console.log(`    [1/5] Deploying MCPServer with container-level security overrides...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=True
          console.log(`    [2/5] Waiting for Accepted=True, Valid...`);
          await k8s.waitForCondition(serverName, 'Accepted', 'True', 'Valid', namespace, 30);
          console.log(`    ✓ Accepted: True, Valid`);

          // Step 3: Wait for Ready=True
          console.log(`    [3/5] Waiting for Ready=True, Available...`);
          await k8s.waitForCondition(serverName, 'Ready', 'True', 'Available', namespace, 120);
          console.log(`    ✓ Ready: True, Available`);

          // Step 4: Inspect Deployment for security context configuration
          console.log(`    [4/5] Inspecting Deployment security contexts...`);
          const { stdout: deploymentRaw } = await execAsync(
            `kubectl get deployment ${serverName} -n ${namespace} -o json`
          );
          const deployment = JSON.parse(deploymentRaw);
          const podSpec = deployment.spec.template.spec;
          const container = podSpec.containers[0];

          // Verify pod-level security context
          test.assertEqual(podSpec.securityContext?.runAsUser, 1000, 'Pod-level runAsUser should be 1000');
          test.assertEqual(podSpec.securityContext?.runAsGroup, 3000, 'Pod-level runAsGroup should be 3000');
          console.log(`    ✓ Pod-level: runAsUser=${podSpec.securityContext?.runAsUser}, runAsGroup=${podSpec.securityContext?.runAsGroup}`);

          // Verify container-level security context overrides
          test.assertEqual(container.securityContext?.runAsUser, 2000, 'Container-level runAsUser should be 2000');
          test.assertEqual(container.securityContext?.runAsGroup, 4000, 'Container-level runAsGroup should be 4000');
          test.assertEqual(container.securityContext?.runAsNonRoot, true, 'Container-level runAsNonRoot should be true');
          console.log(`    ✓ Container-level: runAsUser=${container.securityContext?.runAsUser}, runAsGroup=${container.securityContext?.runAsGroup}, runAsNonRoot=${container.securityContext?.runAsNonRoot}`);

          // Step 5: Verify actual runtime identity via kubectl exec
          console.log(`    [5/5] Verifying actual runtime identity via kubectl exec...`);
          const { stdout: podNameRaw } = await execAsync(
            `kubectl get pods -n ${namespace} -l mcp-server=${serverName} -o jsonpath='{.items[0].metadata.name}'`
          );
          const podName = podNameRaw.trim().replace(/'/g, '');
          const { stdout: idOutput } = await execAsync(
            `kubectl exec ${podName} -n ${namespace} -- id`
          );
          console.log(`    ✓ Runtime identity: ${idOutput.trim()}`);

          // Parse id output: "uid=2000 gid=4000 groups=4000,3000"
          const uidMatch = idOutput.match(/uid=(\d+)/);
          const gidMatch = idOutput.match(/gid=(\d+)/);
          test.assert(uidMatch !== null, 'Should be able to parse UID from id output');
          test.assert(gidMatch !== null, 'Should be able to parse GID from id output');

          const actualUid = parseInt(uidMatch![1], 10);
          const actualGid = parseInt(gidMatch![1], 10);

          test.assertEqual(actualUid, 2000, `Runtime UID should be 2000 (container override), got ${actualUid}`);
          test.assertEqual(actualGid, 4000, `Runtime GID should be 4000 (container override), got ${actualGid}`);

          console.log(`    ✓ Container-level security overrides verified: UID=${actualUid}, GID=${actualGid}`);
          console.log(`    ✓ Pod-level values (1000/3000) correctly overridden by container-level (2000/4000)`);
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
