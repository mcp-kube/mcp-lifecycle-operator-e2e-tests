/**
 * Shared type definitions for the MCP E2E test framework
 */

export interface Tool {
  name: string;
  description?: string;
  inputSchema: any;
}

export interface Resource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface Prompt {
  name: string;
  description?: string;
  arguments?: any[];
}

export interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  duration: number;
  error?: Error;
}

export type TestFunction = {
  (name: string, fn: () => Promise<void>): Promise<void>;
  assert: (condition: boolean, message: string) => void;
  assertEqual: (actual: any, expected: any, message?: string) => void;
  assertContains: (array: any[], item: any, message?: string) => void;
  assertDeepEqual: (actual: any, expected: any, message?: string) => void;
};
