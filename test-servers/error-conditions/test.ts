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
    transitionValidation: {
      name: 'ConfigurationInvalid should be immediate',
      expectedTransitions: [
        {
          conditionType: 'Ready',
          status: 'False',
          reason: 'ConfigurationInvalid',
          messageContains: 'Configuration must be fixed',
        },
      ],
      // Configuration errors should be detected immediately - no flickers
      ...TransitionValidator.noOptimisticLockFlickers(),
      allowExtraTransitions: false, // Expect exactly 1 transition
    },
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
    transitionValidation: {
      name: 'ImagePullBackOff should show DeploymentUnavailable',
      expectedTransitions: [
        // Final state should be DeploymentUnavailable due to image pull failure
        {
          conditionType: 'Ready',
          status: 'False',
          reason: 'DeploymentUnavailable',
          // Should NOT be due to optimistic lock conflict
          messageNotContains: 'object has been modified',
        },
      ],
      // Forbid optimistic lock conflict flickers
      ...TransitionValidator.noOptimisticLockFlickers(),
      // May have multiple transitions as deployment stabilizes
      allowExtraTransitions: true,
    },
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
    transitionValidation: {
      name: 'ScaledToZero should not flicker',
      expectedTransitions: [
        {
          conditionType: 'Ready',
          status: 'True',
          reason: 'ScaledToZero',
          messageContains: 'scaled to 0 replicas',
        },
      ],
      // Forbid optimistic lock conflict flickers
      ...TransitionValidator.noOptimisticLockFlickers(),
      // Allow extra transitions for now (we might see multiple updates during reconciliation)
      allowExtraTransitions: true,
    },
  },
];

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const framework = new TestFramework('error-conditions');
  const k8s = new K8sUtils();
  const namespace = 'default';
  const manifestsDir = path.join(__dirname, 'manifests');
  const debugYaml = process.env.DEBUG_YAML === '1' || process.env.DEBUG_YAML === 'true';

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
      for (const testCase of testCases) {
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

          // Wait for the condition to stabilize
          const stabilizationTime = testCase.stabilizationTime || 10;
          console.log(`    Waiting ${stabilizationTime}s for conditions to stabilize...`);
          await sleep(stabilizationTime * 1000);

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
          await execAsync(`kubectl delete mcpserver ${testCase.serverName} -n ${namespace} --ignore-not-found=true`);

          // Wait a bit for cleanup to complete
          await sleep(2000);
        });
      }
    });
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }

  process.exit(framework.exitCode);
}

main();
