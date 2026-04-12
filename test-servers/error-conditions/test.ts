#!/usr/bin/env node
/**
 * E2E tests for MCP Lifecycle Operator Error Conditions
 *
 * This test validates error conditions and their corresponding
 * status conditions introduced in PR #75.
 */

import {
  TestFramework,
  K8sUtils,
  StatusWatcher,
  TransitionValidator,
  ValidationRules,
  type TransitionValidationRule,
} from '../../framework/src/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestCase {
  name: string;
  manifestFile: string;
  serverName: string;
  expectedAcceptedStatus: 'True' | 'False';
  expectedAcceptedReason: string;
  expectedReadyStatus: 'True' | 'False' | 'Unknown';
  expectedReadyReason: string;
  description: string;
  // How long to wait for the condition to stabilize (some errors take time to appear)
  stabilizationTime?: number;
  // Expected transition validation rule
  transitionValidation?: TransitionValidationRule;
}

const testCases: TestCase[] = [
  {
    name: 'Missing Secret in storage',
    manifestFile: '01-missing-secret-storage.yaml',
    serverName: 'error-missing-secret-storage',
    expectedAcceptedStatus: 'False',
    expectedAcceptedReason: 'Invalid',
    expectedReadyStatus: 'False',
    expectedReadyReason: 'ConfigurationInvalid',
    description: 'Secret referenced in storage does not exist',
    stabilizationTime: 5,
    transitionValidation: ValidationRules.configurationInvalid(),
  },
  {
    name: 'Missing ConfigMap in storage',
    manifestFile: '02-missing-configmap-storage.yaml',
    serverName: 'error-missing-configmap-storage',
    expectedAcceptedStatus: 'False',
    expectedAcceptedReason: 'Invalid',
    expectedReadyStatus: 'False',
    expectedReadyReason: 'ConfigurationInvalid',
    description: 'ConfigMap referenced in storage does not exist',
    stabilizationTime: 5,
  },
  {
    name: 'Missing Secret in envFrom',
    manifestFile: '03-missing-secret-envfrom.yaml',
    serverName: 'error-missing-secret-envfrom',
    expectedAcceptedStatus: 'False',
    expectedAcceptedReason: 'Invalid',
    expectedReadyStatus: 'False',
    expectedReadyReason: 'ConfigurationInvalid',
    description: 'Secret referenced in envFrom does not exist',
    stabilizationTime: 5,
  },
  {
    name: 'Missing ConfigMap in envFrom',
    manifestFile: '04-missing-configmap-envfrom.yaml',
    serverName: 'error-missing-configmap-envfrom',
    expectedAcceptedStatus: 'False',
    expectedAcceptedReason: 'Invalid',
    expectedReadyStatus: 'False',
    expectedReadyReason: 'ConfigurationInvalid',
    description: 'ConfigMap referenced in envFrom does not exist',
    stabilizationTime: 5,
  },
  {
    name: 'ImagePullBackOff',
    manifestFile: '05-image-pull-backoff.yaml',
    serverName: 'error-image-pull-backoff',
    expectedAcceptedStatus: 'True',
    expectedAcceptedReason: 'Valid',
    expectedReadyStatus: 'False',
    expectedReadyReason: 'DeploymentUnavailable',
    description: 'Non-existent image causes ImagePullBackOff',
    stabilizationTime: 60, // Image pull errors take time to appear
    transitionValidation: ValidationRules.imagePullBackOff(),
  },
  {
    name: 'CrashLoopBackOff',
    manifestFile: '06-crash-loop-backoff.yaml',
    serverName: 'error-crash-loop-backoff',
    expectedAcceptedStatus: 'True',
    expectedAcceptedReason: 'Valid',
    expectedReadyStatus: 'False',
    expectedReadyReason: 'DeploymentUnavailable',
    description: 'Container crashes causing CrashLoopBackOff',
    stabilizationTime: 30, // Crash loop takes time to establish
    transitionValidation: ValidationRules.crashLoopBackOff(),
  },
  {
    name: 'ScaledToZero',
    manifestFile: '07-scaled-to-zero.yaml',
    serverName: 'error-scaled-to-zero',
    expectedAcceptedStatus: 'True',
    expectedAcceptedReason: 'Valid',
    expectedReadyStatus: 'True',  // Changed: PR #75 now sets Ready=True (Kubernetes semantics)
    expectedReadyReason: 'ScaledToZero',
    description: 'Deployment scaled to 0 replicas',
    stabilizationTime: 10,
    transitionValidation: ValidationRules.scaledToZero(),
  },
  {
    name: 'Empty ConfigMap name in storage',
    manifestFile: '08-empty-configmap-name-storage.yaml',
    serverName: 'error-empty-configmap-name-storage',
    expectedAcceptedStatus: 'False',
    expectedAcceptedReason: 'Invalid',
    expectedReadyStatus: 'False',
    expectedReadyReason: 'ConfigurationInvalid',
    description: 'ConfigMap name in storage is empty',
    stabilizationTime: 5,
  },
  {
    name: 'Empty Secret name in storage',
    manifestFile: '09-empty-secret-name-storage.yaml',
    serverName: 'error-empty-secret-name-storage',
    expectedAcceptedStatus: 'False',
    expectedAcceptedReason: 'Invalid',
    expectedReadyStatus: 'False',
    expectedReadyReason: 'ConfigurationInvalid',
    description: 'Secret name in storage is empty',
    stabilizationTime: 5,
  },
  {
    name: 'Optional ConfigMap in storage',
    manifestFile: '12-optional-configmap-storage.yaml',
    serverName: 'optional-configmap-storage',
    expectedAcceptedStatus: 'True',
    expectedAcceptedReason: 'Valid',
    expectedReadyStatus: 'True',
    expectedReadyReason: 'Available',
    description: 'Missing optional ConfigMap should not fail validation',
    stabilizationTime: 60,
  },
  // Note: ServiceUnavailable reason is tested in operator unit tests
  // (internal/controller/mcpserver_controller_test.go - Service Reconciliation Failures)
  // E2E testing of Service reconciliation failures requires API client interceptors,
  // which is not feasible in real cluster environments.
];

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run a single test case
 * Extracted into a function to support both sequential and parallel execution
 */
async function runTestCase(
  testCase: TestCase,
  test: any,
  k8s: K8sUtils,
  namespace: string,
  manifestsDir: string,
  debugDir: string,
  debugYaml: boolean
): Promise<void> {
  const manifestPath = path.join(manifestsDir, testCase.manifestFile);

  await test(`${testCase.name}: ${testCase.description}`, async () => {
    console.log(`    Deploying ${testCase.serverName}...`);

    // Start status watcher BEFORE deploying if DEBUG_YAML is enabled
    let watcher: StatusWatcher | undefined;
    if (debugYaml) {
      const watchDir = path.join(debugDir, `${testCase.serverName}-status-transitions`);
      watcher = new StatusWatcher({
        serverName: testCase.serverName,
        namespace,
        outputDir: watchDir,
      });

      // Write input manifest to file
      const inputFile = path.join(debugDir, `${testCase.serverName}-input.yaml`);
      const { stdout: manifestContent } = await execAsync(`cat ${manifestPath}`);
      fs.writeFileSync(inputFile, manifestContent);
      console.log(`    [DEBUG_YAML] Input manifest: ${inputFile}`);

      // Start watcher BEFORE deploying to capture all transitions
      await watcher.start();
      // Give watcher a moment to start up
      await sleep(500);
    }

    // Deploy the manifest
    await execAsync(`kubectl apply -f ${manifestPath}`);

    // Wait for conditions to reach expected state (with polling)
    const stabilizationTime = testCase.stabilizationTime || 10;
    console.log(`    Waiting for conditions to reach expected state (timeout: ${stabilizationTime}s)...`);

    try {
      // Wait for Ready condition to reach expected state
      await k8s.waitForCondition(
        testCase.serverName,
        'Ready',
        testCase.expectedReadyStatus,
        testCase.expectedReadyReason,
        namespace,
        stabilizationTime
      );
    } catch (err) {
      // If polling fails, that's okay - we'll verify in the assertions below
      console.log(`    ⚠️  Polling timed out, checking current state...`);
    }

    // Get and verify Accepted condition
    const acceptedCondition = await k8s.getMCPServerCondition(
      testCase.serverName,
      'Accepted',
      namespace
    );

    console.log(
      `    Accepted: status=${acceptedCondition.status}, reason=${acceptedCondition.reason}, message="${acceptedCondition.message}"`
    );
    test.assertEqual(
      acceptedCondition.status,
      testCase.expectedAcceptedStatus,
      `Accepted status should be ${testCase.expectedAcceptedStatus}`
    );
    test.assertEqual(
      acceptedCondition.reason,
      testCase.expectedAcceptedReason,
      `Accepted reason should be ${testCase.expectedAcceptedReason}`
    );

    // Get and verify Ready condition
    const readyCondition = await k8s.getMCPServerCondition(
      testCase.serverName,
      'Ready',
      namespace
    );

    console.log(
      `    Ready: status=${readyCondition.status}, reason=${readyCondition.reason}, message="${readyCondition.message}"`
    );
    test.assertEqual(
      readyCondition.status,
      testCase.expectedReadyStatus,
      `Ready status should be ${testCase.expectedReadyStatus}`
    );
    test.assertEqual(
      readyCondition.reason,
      testCase.expectedReadyReason,
      `Ready reason should be ${testCase.expectedReadyReason}`
    );

    // Verify observedGeneration is set
    const observedGeneration = await k8s.getMCPServerObservedGeneration(
      testCase.serverName,
      namespace
    );
    test.assert(observedGeneration > 0, 'observedGeneration should be greater than 0');

    if (debugYaml) {
      // Write output status to file
      const outputFile = path.join(debugDir, `${testCase.serverName}-output.yaml`);
      const { stdout: statusYaml } = await execAsync(
        `kubectl get mcpserver ${testCase.serverName} -n ${namespace} -o yaml`
      );
      fs.writeFileSync(outputFile, statusYaml);
      console.log(`    [DEBUG_YAML] Output status: ${outputFile}`);

      // Stop watcher
      if (watcher) {
        watcher.stop();
      }

      // Validate status transitions if validation rule is defined
      if (testCase.transitionValidation) {
        const watchDir = path.join(debugDir, `${testCase.serverName}-status-transitions`);
        console.log(`    [TRANSITION_VALIDATION] Validating transitions...`);

        const validationResult = TransitionValidator.validate(
          testCase.transitionValidation,
          watchDir
        );

        // Print formatted result
        const formattedResult = TransitionValidator.formatResult(validationResult);
        console.log(formattedResult.split('\n').map(line => `    ${line}`).join('\n'));

        // Fail test if validation failed
        test.assert(
          validationResult.passed,
          `Transition validation failed:\n${validationResult.errors.join('\n')}`
        );
      }
    }

    // Cleanup
    console.log(`    Cleaning up ${testCase.serverName}...`);
    // Delete all resources from the manifest (Services, MCPServers, etc.)
    await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);

    // Wait a bit for cleanup to complete
    await sleep(2000);
  });
}

async function main() {
  const framework = new TestFramework('error-conditions');
  const k8s = new K8sUtils();
  const namespace = 'default';
  const manifestsDir = path.join(__dirname, 'manifests');
  const debugYaml = process.env.DEBUG_YAML === '1' || process.env.DEBUG_YAML === 'true';
  const parallel = process.env.PARALLEL_TESTS === '1' || process.env.PARALLEL_TESTS === 'true';

  // Create debug output directory if DEBUG_YAML is enabled
  let debugDir = '';
  if (debugYaml) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    debugDir = path.join(__dirname, '../../logs/debug-yaml', `error-conditions-${timestamp}`);
    fs.mkdirSync(debugDir, { recursive: true });
    console.log(`    [DEBUG_YAML] Output directory: ${debugDir}`);
  }

  try {
    await framework.run(async (test) => {
      if (parallel) {
        console.log('    [PARALLEL] Running tests in parallel groups...');

        // Group 1: Configuration errors (can run in parallel - fast, no resource contention)
        const configErrorTests = testCases.filter(tc =>
          tc.name.includes('Missing') && (tc.name.includes('Secret') || tc.name.includes('ConfigMap'))
        );

        // Group 2: Deployment errors (sequential - resource intensive)
        const deploymentErrorTests = testCases.filter(tc =>
          tc.name.includes('ImagePull') || tc.name.includes('CrashLoop')
        );

        // Group 3: Scaling and optional resource tests
        const scalingTests = testCases.filter(tc =>
          tc.name.includes('ScaledToZero') || tc.name.includes('Optional')
        );

        // Run groups in parallel
        await Promise.all([
          // Group 1: All config errors in parallel
          Promise.all(
            configErrorTests.map(tc =>
              runTestCase(tc, test, k8s, namespace, manifestsDir, debugDir, debugYaml)
            )
          ),

          // Group 2: Deployment errors sequentially
          (async () => {
            for (const tc of deploymentErrorTests) {
              await runTestCase(tc, test, k8s, namespace, manifestsDir, debugDir, debugYaml);
            }
          })(),

          // Group 3: Scaling tests
          Promise.all(
            scalingTests.map(tc =>
              runTestCase(tc, test, k8s, namespace, manifestsDir, debugDir, debugYaml)
            )
          ),
        ]);
      } else {
        // Sequential execution (original behavior)
        for (const testCase of testCases) {
          await runTestCase(testCase, test, k8s, namespace, manifestsDir, debugDir, debugYaml);
        }
      }

      // Recovery test: Fix missing ConfigMap
      await test('Recovery: Fix missing ConfigMap', async () => {
        const serverName = 'recovery-missing-configmap';
        const configMapName = 'recovery-test-configmap';
        const manifestPath = path.join(manifestsDir, '10-recovery-missing-configmap.yaml');

        console.log(`    Testing recovery from missing ConfigMap...`);

        try {
          // Step 1: Deploy MCPServer with missing ConfigMap
          console.log(`    [1/6] Deploying ${serverName} with missing ConfigMap...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=False, Invalid
          console.log(`    [2/6] Waiting for Accepted=False, Invalid...`);
          await k8s.waitForCondition(
            serverName,
            'Accepted',
            'False',
            'Invalid',
            namespace,
            10
          );

          const initialAcceptedCondition = await k8s.getMCPServerCondition(serverName, 'Accepted', namespace);
          const initialReadyCondition = await k8s.getMCPServerCondition(serverName, 'Ready', namespace);
          const initialAcceptedTransitionTime = initialAcceptedCondition.lastTransitionTime;
          const initialReadyTransitionTime = initialReadyCondition.lastTransitionTime;

          console.log(`    Initial Accepted: status=${initialAcceptedCondition.status}, reason=${initialAcceptedCondition.reason}`);
          console.log(`    Initial Ready: status=${initialReadyCondition.status}, reason=${initialReadyCondition.reason}`);

          // Verify initial error state
          test.assertEqual(initialAcceptedCondition.status, 'False', 'Accepted should be False initially');
          test.assertEqual(initialAcceptedCondition.reason, 'Invalid', 'Accepted reason should be Invalid');
          test.assertEqual(initialReadyCondition.status, 'False', 'Ready should be False initially');
          test.assertEqual(initialReadyCondition.reason, 'ConfigurationInvalid', 'Ready reason should be ConfigurationInvalid');
          test.assert(
            initialAcceptedCondition.message.includes(configMapName),
            `Accepted message should mention ConfigMap name: ${initialAcceptedCondition.message}`
          );

          // Step 3: Create the missing ConfigMap
          console.log(`    [3/6] Creating missing ConfigMap ${configMapName}...`);
          const configMapYaml = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${configMapName}
  namespace: ${namespace}
data:
  config.json: '{"test": "data"}'
`;
          const configMapFile = `/tmp/${configMapName}.yaml`;
          fs.writeFileSync(configMapFile, configMapYaml);
          await execAsync(`kubectl apply -f ${configMapFile}`);

          // Trigger reconciliation by updating the MCPServer spec (bump generation)
          // We add a harmless environment variable to trigger reconciliation
          console.log(`    Triggering reconciliation by updating MCPServer spec...`);
          const patchJson = {
            spec: {
              config: {
                env: [
                  {
                    name: 'RECOVERY_TRIGGER',
                    value: new Date().getTime().toString()
                  }
                ]
              }
            }
          };
          await execAsync(
            `kubectl patch mcpserver ${serverName} -n ${namespace} --type=merge -p '${JSON.stringify(patchJson)}'`
          );

          // Step 4: Wait for Accepted=True, Valid
          console.log(`    [4/6] Waiting for Accepted=True, Valid...`);
          await k8s.waitForCondition(
            serverName,
            'Accepted',
            'True',
            'Valid',
            namespace,
            30
          );

          const recoveredAcceptedCondition = await k8s.getMCPServerCondition(serverName, 'Accepted', namespace);
          console.log(`    Recovered Accepted: status=${recoveredAcceptedCondition.status}, reason=${recoveredAcceptedCondition.reason}`);

          test.assertEqual(recoveredAcceptedCondition.status, 'True', 'Accepted should be True after recovery');
          test.assertEqual(recoveredAcceptedCondition.reason, 'Valid', 'Accepted reason should be Valid after recovery');

          // Verify lastTransitionTime changed or stayed same (if reconciliation happened in same second)
          // This is expected Kubernetes behavior - timestamps have second granularity
          test.assert(
            recoveredAcceptedCondition.lastTransitionTime >= initialAcceptedTransitionTime,
            `Accepted lastTransitionTime should be >= initial time (was ${initialAcceptedTransitionTime}, now ${recoveredAcceptedCondition.lastTransitionTime})`
          );
          if (recoveredAcceptedCondition.lastTransitionTime !== initialAcceptedTransitionTime) {
            console.log(`    Accepted lastTransitionTime changed: ${initialAcceptedTransitionTime} → ${recoveredAcceptedCondition.lastTransitionTime}`);
          } else {
            console.log(`    Accepted lastTransitionTime unchanged (fast reconciliation within same second)`);
          }

          // Step 5: Wait for Ready=True, Available
          console.log(`    [5/6] Waiting for Ready=True, Available...`);
          await k8s.waitForCondition(
            serverName,
            'Ready',
            'True',
            'Available',
            namespace,
            60
          );

          const recoveredReadyCondition = await k8s.getMCPServerCondition(serverName, 'Ready', namespace);
          console.log(`    Recovered Ready: status=${recoveredReadyCondition.status}, reason=${recoveredReadyCondition.reason}`);

          test.assertEqual(recoveredReadyCondition.status, 'True', 'Ready should be True after deployment succeeds');
          test.assertEqual(recoveredReadyCondition.reason, 'Available', 'Ready reason should be Available');

          // Verify lastTransitionTime changed (should always change for Ready since pods need to start)
          test.assert(
            recoveredReadyCondition.lastTransitionTime > initialReadyTransitionTime,
            `Ready lastTransitionTime should increase (was ${initialReadyTransitionTime}, now ${recoveredReadyCondition.lastTransitionTime})`
          );
          console.log(`    Ready lastTransitionTime changed: ${initialReadyTransitionTime} → ${recoveredReadyCondition.lastTransitionTime}`);

          // Step 6: Verify observedGeneration is set
          console.log(`    [6/6] Verifying status fields...`);
          const observedGeneration = await k8s.getMCPServerObservedGeneration(serverName, namespace);
          test.assert(observedGeneration > 0, 'observedGeneration should be greater than 0');

          console.log(`    ✓ Recovery successful: Accepted=True, Ready=True`);
        } finally {
          // Cleanup
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await execAsync(`kubectl delete configmap ${configMapName} -n ${namespace} --ignore-not-found=true`);
          await sleep(2000);
        }
      });

      // Recovery test: Fix missing Secret
      await test('Recovery: Fix missing Secret', async () => {
        const serverName = 'recovery-missing-secret';
        const secretName = 'recovery-test-secret';
        const manifestPath = path.join(manifestsDir, '11-recovery-missing-secret.yaml');

        console.log(`    Testing recovery from missing Secret...`);

        try {
          // Step 1: Deploy MCPServer with missing Secret
          console.log(`    [1/6] Deploying ${serverName} with missing Secret...`);
          await execAsync(`kubectl apply -f ${manifestPath}`);

          // Step 2: Wait for Accepted=False, Invalid
          console.log(`    [2/6] Waiting for Accepted=False, Invalid...`);
          await k8s.waitForCondition(
            serverName,
            'Accepted',
            'False',
            'Invalid',
            namespace,
            10
          );

          const initialAcceptedCondition = await k8s.getMCPServerCondition(serverName, 'Accepted', namespace);
          const initialReadyCondition = await k8s.getMCPServerCondition(serverName, 'Ready', namespace);
          const initialAcceptedTransitionTime = initialAcceptedCondition.lastTransitionTime;
          const initialReadyTransitionTime = initialReadyCondition.lastTransitionTime;

          console.log(`    Initial Accepted: status=${initialAcceptedCondition.status}, reason=${initialAcceptedCondition.reason}`);
          console.log(`    Initial Ready: status=${initialReadyCondition.status}, reason=${initialReadyCondition.reason}`);

          // Verify initial error state
          test.assertEqual(initialAcceptedCondition.status, 'False', 'Accepted should be False initially');
          test.assertEqual(initialAcceptedCondition.reason, 'Invalid', 'Accepted reason should be Invalid');
          test.assertEqual(initialReadyCondition.status, 'False', 'Ready should be False initially');
          test.assertEqual(initialReadyCondition.reason, 'ConfigurationInvalid', 'Ready reason should be ConfigurationInvalid');
          test.assert(
            initialAcceptedCondition.message.includes(secretName),
            `Accepted message should mention Secret name: ${initialAcceptedCondition.message}`
          );

          // Step 3: Create the missing Secret
          console.log(`    [3/6] Creating missing Secret ${secretName}...`);
          const secretYaml = `
apiVersion: v1
kind: Secret
metadata:
  name: ${secretName}
  namespace: ${namespace}
type: Opaque
data:
  secret-key: dGVzdC1zZWNyZXQtdmFsdWU=  # base64("test-secret-value")
`;
          const secretFile = `/tmp/${secretName}.yaml`;
          fs.writeFileSync(secretFile, secretYaml);
          await execAsync(`kubectl apply -f ${secretFile}`);

          // Trigger reconciliation by updating the MCPServer spec (bump generation)
          // We add a harmless environment variable to trigger reconciliation
          console.log(`    Triggering reconciliation by updating MCPServer spec...`);
          const patchJson = {
            spec: {
              config: {
                env: [
                  {
                    name: 'RECOVERY_TRIGGER',
                    value: new Date().getTime().toString()
                  }
                ]
              }
            }
          };
          await execAsync(
            `kubectl patch mcpserver ${serverName} -n ${namespace} --type=merge -p '${JSON.stringify(patchJson)}'`
          );

          // Step 4: Wait for Accepted=True, Valid
          console.log(`    [4/6] Waiting for Accepted=True, Valid...`);
          await k8s.waitForCondition(
            serverName,
            'Accepted',
            'True',
            'Valid',
            namespace,
            30
          );

          const recoveredAcceptedCondition = await k8s.getMCPServerCondition(serverName, 'Accepted', namespace);
          console.log(`    Recovered Accepted: status=${recoveredAcceptedCondition.status}, reason=${recoveredAcceptedCondition.reason}`);

          test.assertEqual(recoveredAcceptedCondition.status, 'True', 'Accepted should be True after recovery');
          test.assertEqual(recoveredAcceptedCondition.reason, 'Valid', 'Accepted reason should be Valid after recovery');

          // Verify lastTransitionTime changed or stayed same (if reconciliation happened in same second)
          // This is expected Kubernetes behavior - timestamps have second granularity
          test.assert(
            recoveredAcceptedCondition.lastTransitionTime >= initialAcceptedTransitionTime,
            `Accepted lastTransitionTime should be >= initial time (was ${initialAcceptedTransitionTime}, now ${recoveredAcceptedCondition.lastTransitionTime})`
          );
          if (recoveredAcceptedCondition.lastTransitionTime !== initialAcceptedTransitionTime) {
            console.log(`    Accepted lastTransitionTime changed: ${initialAcceptedTransitionTime} → ${recoveredAcceptedCondition.lastTransitionTime}`);
          } else {
            console.log(`    Accepted lastTransitionTime unchanged (fast reconciliation within same second)`);
          }

          // Step 5: Wait for Ready=True, Available
          console.log(`    [5/6] Waiting for Ready=True, Available...`);
          await k8s.waitForCondition(
            serverName,
            'Ready',
            'True',
            'Available',
            namespace,
            60
          );

          const recoveredReadyCondition = await k8s.getMCPServerCondition(serverName, 'Ready', namespace);
          console.log(`    Recovered Ready: status=${recoveredReadyCondition.status}, reason=${recoveredReadyCondition.reason}`);

          test.assertEqual(recoveredReadyCondition.status, 'True', 'Ready should be True after deployment succeeds');
          test.assertEqual(recoveredReadyCondition.reason, 'Available', 'Ready reason should be Available');

          // Verify lastTransitionTime changed (should always change for Ready since pods need to start)
          test.assert(
            recoveredReadyCondition.lastTransitionTime > initialReadyTransitionTime,
            `Ready lastTransitionTime should increase (was ${initialReadyTransitionTime}, now ${recoveredReadyCondition.lastTransitionTime})`
          );
          console.log(`    Ready lastTransitionTime changed: ${initialReadyTransitionTime} → ${recoveredReadyCondition.lastTransitionTime}`);

          // Step 6: Verify observedGeneration is set
          console.log(`    [6/6] Verifying status fields...`);
          const observedGeneration = await k8s.getMCPServerObservedGeneration(serverName, namespace);
          test.assert(observedGeneration > 0, 'observedGeneration should be greater than 0');

          console.log(`    ✓ Recovery successful: Accepted=True, Ready=True`);
        } finally {
          // Cleanup
          console.log(`    Cleaning up ${serverName}...`);
          await execAsync(`kubectl delete -f ${manifestPath} --ignore-not-found=true`);
          await execAsync(`kubectl delete secret ${secretName} -n ${namespace} --ignore-not-found=true`);
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
