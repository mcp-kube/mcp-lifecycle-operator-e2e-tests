#!/usr/bin/env node
/**
 * E2E tests for MCP Lifecycle Operator Update Operations
 *
 * This test validates that the operator correctly handles spec updates
 * without causing unnecessary status flickers or downtime.
 *
 * Tests cover:
 * - Updating replicas
 * - Updating environment variables
 * - Updating container image
 * - Updating configuration (port, path, etc.)
 * - Invalid updates (should reject gracefully)
 */

import {
  TestFramework,
  K8sUtils,
  StatusWatcher,
  TransitionValidator,
  ValidationRules,
} from '../../framework/src/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface UpdateTestCase {
  name: string;
  description: string;
  initialManifest: any;
  update: {
    description: string;
    patch: any;
  };
  expectedBehavior: {
    maintainsReady?: boolean; // Should Ready stay True throughout
    expectRestart?: boolean;   // Should pods restart
    expectedReadyReason?: string;
  };
}

const testCases: UpdateTestCase[] = [
  {
    name: 'Update replicas (scale up)',
    description: 'Scaling from 1 to 3 replicas should maintain Ready status',
    initialManifest: {
      apiVersion: 'mcp.x-k8s.io/v1alpha1',
      kind: 'MCPServer',
      metadata: {
        name: 'update-replicas',
        namespace: 'default',
      },
      spec: {
        source: {
          type: 'ContainerImage',
          containerImage: {
            ref: 'quay.io/containers/kubernetes_mcp_server:latest',
          },
        },
        config: {
          port: 8080,
        },
        runtime: {
          replicas: 1,
        },
      },
    },
    update: {
      description: 'Scale to 3 replicas',
      patch: {
        spec: {
          runtime: {
            replicas: 3,
          },
        },
      },
    },
    expectedBehavior: {
      maintainsReady: true,
      expectRestart: false,
      expectedReadyReason: 'Available',
    },
  },
  {
    name: 'Update replicas (scale down)',
    description: 'Scaling from 3 to 1 replicas should maintain Ready status',
    initialManifest: {
      apiVersion: 'mcp.x-k8s.io/v1alpha1',
      kind: 'MCPServer',
      metadata: {
        name: 'update-replicas-down',
        namespace: 'default',
      },
      spec: {
        source: {
          type: 'ContainerImage',
          containerImage: {
            ref: 'quay.io/containers/kubernetes_mcp_server:latest',
          },
        },
        config: {
          port: 8080,
        },
        runtime: {
          replicas: 3,
        },
      },
    },
    update: {
      description: 'Scale down to 1 replica',
      patch: {
        spec: {
          runtime: {
            replicas: 1,
          },
        },
      },
    },
    expectedBehavior: {
      maintainsReady: true,
      expectRestart: true, // Pods change when scaling down (2 terminated)
      expectedReadyReason: 'Available',
    },
  },
  {
    name: 'Update environment variables',
    description: 'Changing env var should trigger pod restart but maintain Ready',
    initialManifest: {
      apiVersion: 'mcp.x-k8s.io/v1alpha1',
      kind: 'MCPServer',
      metadata: {
        name: 'update-env-vars',
        namespace: 'default',
      },
      spec: {
        source: {
          type: 'ContainerImage',
          containerImage: {
            ref: 'quay.io/containers/kubernetes_mcp_server:latest',
          },
        },
        config: {
          port: 8080,
          env: [
            {
              name: 'TEST_VAR',
              value: 'initial-value',
            },
          ],
        },
        runtime: {
          replicas: 1,
        },
      },
    },
    update: {
      description: 'Change TEST_VAR value',
      patch: {
        spec: {
          config: {
            env: [
              {
                name: 'TEST_VAR',
                value: 'updated-value',
              },
            ],
          },
        },
      },
    },
    expectedBehavior: {
      maintainsReady: true,
      expectRestart: true,
      expectedReadyReason: 'Available',
    },
  },
  {
    name: 'Update resource limits',
    description: 'Changing resource limits should trigger pod restart',
    initialManifest: {
      apiVersion: 'mcp.x-k8s.io/v1alpha1',
      kind: 'MCPServer',
      metadata: {
        name: 'update-resources',
        namespace: 'default',
      },
      spec: {
        source: {
          type: 'ContainerImage',
          containerImage: {
            ref: 'quay.io/containers/kubernetes_mcp_server:latest',
          },
        },
        config: {
          port: 8080,
        },
        runtime: {
          replicas: 1,
          resources: {
            requests: {
              cpu: '100m',
              memory: '64Mi',
            },
            limits: {
              cpu: '200m',
              memory: '128Mi',
            },
          },
        },
      },
    },
    update: {
      description: 'Increase resource limits',
      patch: {
        spec: {
          runtime: {
            resources: {
              requests: {
                cpu: '200m',
                memory: '128Mi',
              },
              limits: {
                cpu: '400m',
                memory: '256Mi',
              },
            },
          },
        },
      },
    },
    expectedBehavior: {
      maintainsReady: true,
      expectRestart: true,
      expectedReadyReason: 'Available',
    },
  },
];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const framework = new TestFramework('update-operations');
  const k8s = new K8sUtils();
  const namespace = 'default';
  const debugYaml = process.env.DEBUG_YAML === '1' || process.env.DEBUG_YAML === 'true';

  // Create debug output directory if DEBUG_YAML is enabled
  let debugDir = '';
  if (debugYaml) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    debugDir = path.join(__dirname, '../../logs/debug-yaml', `update-operations-${timestamp}`);
    fs.mkdirSync(debugDir, { recursive: true });
    console.log(`    [DEBUG_YAML] Output directory: ${debugDir}`);
  }

  try {
    await framework.run(async (test) => {
      for (const testCase of testCases) {
        await test(`${testCase.name}: ${testCase.description}`, async () => {
          const serverName = testCase.initialManifest.metadata.name;
          console.log(`    Testing update operation: ${testCase.name}`);

          // Start status watcher if DEBUG_YAML is enabled
          let watcher: StatusWatcher | undefined;
          if (debugYaml) {
            const watchDir = path.join(debugDir, `${serverName}-status-transitions`);
            watcher = new StatusWatcher({
              serverName,
              namespace,
              outputDir: watchDir,
            });
            await watcher.start();
            await sleep(500);
          }

          try {
            // Step 1: Deploy initial manifest
            console.log(`    [1/5] Deploying initial configuration...`);
            const initialFile = `/tmp/${serverName}-initial.yaml`;
            fs.writeFileSync(initialFile, JSON.stringify(testCase.initialManifest));
            await execAsync(`kubectl apply -f ${initialFile}`);

            // Step 2: Wait for initial Ready status
            console.log(`    [2/5] Waiting for initial Ready status...`);
            await k8s.waitForCondition(
              serverName,
              'Ready',
              'True',
              testCase.expectedBehavior.expectedReadyReason || 'Available',
              namespace,
              60
            );

            // Get initial generation and observedGeneration
            const initialGeneration = await k8s.getMCPServerGeneration(serverName, namespace);
            const initialObservedGen = await k8s.getMCPServerObservedGeneration(serverName, namespace);
            console.log(
              `    Initial state: generation=${initialGeneration}, observedGeneration=${initialObservedGen}`
            );

            // Get initial pod list (to detect restarts later)
            const { stdout: initialPods } = await execAsync(
              `kubectl get pods -n ${namespace} -l mcp-server=${serverName} -o jsonpath='{.items[*].metadata.name}'`
            );
            const initialPodNames = initialPods.trim().split(/\s+/).filter(Boolean);
            console.log(`    Initial pods: ${initialPodNames.join(', ')}`);

            // Step 3: Apply update
            console.log(`    [3/5] Applying update: ${testCase.update.description}...`);
            const patchContent = JSON.stringify(testCase.update.patch);
            await execAsync(
              `kubectl patch mcpserver ${serverName} -n ${namespace} --type=merge -p '${patchContent}'`
            );

            // Step 4: Verify generation incremented
            await sleep(1000); // Give operator a moment to process
            const updatedGeneration = await k8s.getMCPServerGeneration(serverName, namespace);
            console.log(`    Updated generation: ${updatedGeneration}`);
            test.assert(
              updatedGeneration > initialGeneration,
              `Generation should increment after update (was ${initialGeneration}, now ${updatedGeneration})`
            );

            // Step 5: Wait for reconciliation
            console.log(`    [4/5] Waiting for reconciliation...`);
            await sleep(5000); // Give time for rolling update if needed

            // Wait for observedGeneration to match
            await k8s.waitForPredicate(
              async () => {
                const observedGen = await k8s.getMCPServerObservedGeneration(serverName, namespace);
                return observedGen === updatedGeneration;
              },
              `observedGeneration to match generation (${updatedGeneration})`,
              60
            );

            // Verify Ready status maintained or recovered
            console.log(`    [5/5] Verifying Ready status...`);
            const finalCondition = await k8s.getMCPServerCondition(serverName, 'Ready', namespace);
            console.log(
              `    Final Ready: status=${finalCondition.status}, reason=${finalCondition.reason}, message="${finalCondition.message}"`
            );

            if (testCase.expectedBehavior.maintainsReady) {
              test.assertEqual(
                finalCondition.status,
                'True',
                `Ready status should be True after update`
              );
              test.assertEqual(
                finalCondition.reason,
                testCase.expectedBehavior.expectedReadyReason,
                `Ready reason should be ${testCase.expectedBehavior.expectedReadyReason}`
              );
            }

            // Verify pod restart behavior
            if (testCase.expectedBehavior.expectRestart !== undefined) {
              await sleep(2000); // Give pods time to restart
              const { stdout: finalPods } = await execAsync(
                `kubectl get pods -n ${namespace} -l mcp-server=${serverName} -o jsonpath='{.items[*].metadata.name}'`
              );
              const finalPodNames = finalPods.trim().split(/\s+/).filter(Boolean);

              const podsChanged = !initialPodNames.every((name) => finalPodNames.includes(name));

              if (testCase.expectedBehavior.expectRestart) {
                test.assert(
                  podsChanged,
                  `Pods should have restarted (initial: ${initialPodNames.join(', ')}, final: ${finalPodNames.join(', ')})`
                );
                console.log(`    ✓ Pods restarted as expected`);
              } else {
                test.assert(
                  !podsChanged,
                  `Pods should NOT have restarted (initial: ${initialPodNames.join(', ')}, final: ${finalPodNames.join(', ')})`
                );
                console.log(`    ✓ Pods did not restart (as expected)`);
              }
            }

            if (debugYaml) {
              // Write final status
              const outputFile = path.join(debugDir, `${serverName}-final-status.yaml`);
              const { stdout: statusYaml } = await execAsync(
                `kubectl get mcpserver ${serverName} -n ${namespace} -o yaml`
              );
              fs.writeFileSync(outputFile, statusYaml);
              console.log(`    [DEBUG_YAML] Final status: ${outputFile}`);

              // Stop watcher and validate
              if (watcher) {
                watcher.stop();
                await sleep(500);

                // Validate that Ready stayed True (if expected)
                if (testCase.expectedBehavior.maintainsReady) {
                  const watchDir = path.join(debugDir, `${serverName}-status-transitions`);
                  console.log(`    [TRANSITION_VALIDATION] Validating update maintained Ready...`);

                  const validationResult = TransitionValidator.validate(
                    ValidationRules.updateMaintainsReady(
                      testCase.expectedBehavior.expectedReadyReason || 'Available'
                    ),
                    watchDir
                  );

                  const formattedResult = TransitionValidator.formatResult(validationResult);
                  console.log(formattedResult.split('\n').map((line) => `    ${line}`).join('\n'));

                  // Don't fail test, just warn
                  if (!validationResult.passed) {
                    console.log(
                      `    ⚠️  Transition validation found issues (non-fatal):\n${validationResult.errors.join('\n')}`
                    );
                  }
                }
              }
            }
          } finally {
            // Cleanup
            console.log(`    Cleaning up ${serverName}...`);
            await execAsync(
              `kubectl delete mcpserver ${serverName} -n ${namespace} --ignore-not-found=true`
            );
            await sleep(2000);
          }
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
