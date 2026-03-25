/**
 * Test framework for MCP E2E tests
 * Provides test runner with continue-on-failure and result aggregation
 */

import type { TestResult, TestFunction } from './types.js';

export class TestFramework {
  private results: TestResult[] = [];
  private currentTest: string = '';

  constructor(private serverName: string) {}

  /**
   * Run a test suite with multiple tests
   * Continues execution even if tests fail
   */
  async run(testSuite: (test: TestFunction) => Promise<void>): Promise<void> {
    console.log(`\n=== Testing ${this.serverName} ===\n`);

    const test: TestFunction = async (
      name: string,
      fn: () => Promise<void>
    ) => {
      this.currentTest = name;
      const startTime = Date.now();

      try {
        await fn();
        this.addResult({
          name,
          status: 'passed',
          duration: Date.now() - startTime,
        });
        console.log(`  ✓ ${name}`);
      } catch (error) {
        this.addResult({
          name,
          status: 'failed',
          duration: Date.now() - startTime,
          error: error as Error,
        });
        console.log(`  ✗ ${name}`);
        console.error(`    Error: ${(error as Error).message}`);
      }
    };

    // Add assertion methods
    test.assert = (condition: boolean, message: string) => {
      if (!condition) {
        throw new Error(message);
      }
    };

    test.assertEqual = (actual: any, expected: any, message?: string) => {
      if (actual !== expected) {
        const msg =
          message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
        throw new Error(msg);
      }
    };

    test.assertContains = (array: any[], item: any, message?: string) => {
      if (!array.includes(item)) {
        const msg = message || `Array does not contain ${JSON.stringify(item)}`;
        throw new Error(msg);
      }
    };

    test.assertDeepEqual = (actual: any, expected: any, message?: string) => {
      const actualStr = JSON.stringify(actual);
      const expectedStr = JSON.stringify(expected);
      if (actualStr !== expectedStr) {
        const msg =
          message || `Expected ${expectedStr}, got ${actualStr}`;
        throw new Error(msg);
      }
    };

    try {
      await testSuite(test);
    } catch (error) {
      console.error(`Fatal error in test suite: ${(error as Error).message}`);
      throw error;
    } finally {
      this.printSummary();
    }
  }

  /**
   * Get exit code based on test results
   * Returns 0 if all tests passed, 1 if any failed
   */
  get exitCode(): number {
    return this.results.some((r) => r.status === 'failed') ? 1 : 0;
  }

  /**
   * Get all test results
   */
  getResults(): TestResult[] {
    return [...this.results];
  }

  private addResult(result: TestResult): void {
    this.results.push(result);
  }

  private printSummary(): void {
    const passed = this.results.filter((r) => r.status === 'passed').length;
    const failed = this.results.filter((r) => r.status === 'failed').length;
    const total = this.results.length;

    console.log(`\n=== Results for ${this.serverName} ===`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${total}\n`);
  }
}
