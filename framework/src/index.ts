/**
 * MCP E2E Test Framework
 * Main exports for the testing framework
 */

export { MCPClient } from './mcp-client.js';
export { TestFramework } from './test-framework.js';
export { K8sUtils } from './k8s-utils.js';
export {
  testServerReachable,
  testCanConnect,
  testListTools,
  runCommonTests,
  testCallTool,
} from './common-tests.js';
export type {
  Tool,
  Resource,
  Prompt,
  TestResult,
  TestFunction,
} from './types.js';
