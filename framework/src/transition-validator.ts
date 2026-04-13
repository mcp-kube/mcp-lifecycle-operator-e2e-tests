/**
 * Transition Validator - Validates status transitions match expected patterns
 *
 * This validates that:
 * 1. Status transitions follow expected sequences
 * 2. No unwanted transient failures (e.g., optimistic lock conflicts)
 * 3. Conditions reach expected final states
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface ExpectedTransition {
  // Condition to check
  conditionType: 'Ready' | 'Accepted';

  // Expected status (True, False, Unknown)
  status: 'True' | 'False' | 'Unknown';

  // Expected reason (optional - if not specified, matches any reason)
  reason?: string;

  // Optional: message should contain this substring
  messageContains?: string;

  // Optional: message should NOT contain this substring (for filtering unwanted transitions)
  messageNotContains?: string;
}

export interface TransitionValidationRule {
  // Name of the test scenario
  name: string;

  // Expected sequence of transitions (in order)
  expectedTransitions: ExpectedTransition[];

  // Forbidden transitions (these should never appear)
  forbiddenTransitions?: ExpectedTransition[];

  // Allow additional transitions not in expected list (default: false)
  allowExtraTransitions?: boolean;

  // Require exact match of transition count (default: false)
  strictCount?: boolean;

  // Maximum time in seconds between first and last transition (default: no limit)
  maxTotalDurationSec?: number;

  // Maximum time in seconds between any two consecutive transitions (default: no limit)
  maxTransitionDurationSec?: number;
}

export interface ActualTransition {
  sequenceNumber: number;
  timestamp: string;
  resourceVersion: string;
  conditions: {
    type: string;
    status: string;
    reason: string;
    message: string;
    observedGeneration: number;
  }[];
}

export class TransitionValidator {
  /**
   * Load actual transitions from status-transitions directory
   */
  static loadTransitions(transitionsDir: string): ActualTransition[] {
    if (!fs.existsSync(transitionsDir)) {
      return [];
    }

    const files = fs
      .readdirSync(transitionsDir)
      .filter((f) => f.startsWith('status-transition-') && f.endsWith('.yaml'))
      .sort(); // Sort by filename (sequence number in filename)

    const transitions: ActualTransition[] = [];

    for (const file of files) {
      const filePath = path.join(transitionsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const resource = yaml.load(content) as any;

      // Extract sequence number from filename (status-transition-01-*.yaml)
      const match = file.match(/status-transition-(\d+)-/);
      const sequenceNumber = match ? parseInt(match[1]) : 0;

      transitions.push({
        sequenceNumber,
        timestamp: resource.metadata?.creationTimestamp || '',
        resourceVersion: resource.metadata?.resourceVersion || '',
        conditions:
          resource.status?.conditions?.map((c: any) => ({
            type: c.type,
            status: c.status,
            reason: c.reason,
            message: c.message,
            observedGeneration: c.observedGeneration,
          })) || [],
      });
    }

    return transitions;
  }

  /**
   * Analyze timing between transitions
   */
  static analyzeTiming(
    transitions: ActualTransition[],
    conditionType: 'Ready' | 'Accepted' = 'Ready'
  ): ValidationResult['timing'] | undefined {
    if (transitions.length < 2) {
      return undefined; // Need at least 2 transitions for timing
    }

    const transitionTimings: TransitionTiming[] = [];
    let totalDurationMs = 0;

    for (let i = 0; i < transitions.length - 1; i++) {
      const from = transitions[i];
      const to = transitions[i + 1];

      // Parse timestamps
      const fromTime = new Date(from.timestamp).getTime();
      const toTime = new Date(to.timestamp).getTime();
      const durationMs = toTime - fromTime;

      // Get reasons
      const fromCondition = from.conditions.find((c) => c.type === conditionType);
      const toCondition = to.conditions.find((c) => c.type === conditionType);

      transitionTimings.push({
        fromSequence: from.sequenceNumber,
        toSequence: to.sequenceNumber,
        fromTimestamp: from.timestamp,
        toTimestamp: to.timestamp,
        durationMs,
        durationSec: durationMs / 1000,
        fromReason: fromCondition?.reason || 'unknown',
        toReason: toCondition?.reason || 'unknown',
      });
    }

    // Calculate total duration (first to last)
    const firstTime = new Date(transitions[0].timestamp).getTime();
    const lastTime = new Date(transitions[transitions.length - 1].timestamp).getTime();
    totalDurationMs = lastTime - firstTime;

    // Find slowest transition
    const slowestTransition = transitionTimings.reduce(
      (max, current) => (current.durationMs > max.durationMs ? current : max),
      transitionTimings[0]
    );

    return {
      totalDurationMs,
      totalDurationSec: totalDurationMs / 1000,
      transitionTimings,
      slowestTransition,
    };
  }

  /**
   * Validate transitions against expected rules
   */
  static validate(
    rule: TransitionValidationRule,
    transitionsDir: string
  ): ValidationResult {
    const actual = this.loadTransitions(transitionsDir);
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check forbidden transitions first
    if (rule.forbiddenTransitions) {
      for (const forbidden of rule.forbiddenTransitions) {
        for (const transition of actual) {
          const condition = transition.conditions.find(
            (c) => c.type === forbidden.conditionType
          );
          if (!condition) continue;

          const matches =
            condition.status === forbidden.status &&
            (!forbidden.reason || condition.reason === forbidden.reason);

          const messageMatch =
            !forbidden.messageContains ||
            condition.message.includes(forbidden.messageContains);

          if (matches && messageMatch) {
            errors.push(
              `❌ FORBIDDEN transition found in sequence ${transition.sequenceNumber}: ` +
                `${forbidden.conditionType}=${forbidden.status}` +
                (forbidden.reason ? `, reason=${forbidden.reason}` : '') +
                (forbidden.messageContains
                  ? `, message contains "${forbidden.messageContains}"`
                  : '') +
                `\n   Actual: reason=${condition.reason}, message: "${condition.message.substring(0, 100)}..."`
            );
          }
        }
      }
    }

    // Check expected transitions
    if (rule.expectedTransitions.length > 0) {
      // Extract transitions for comparison (only the condition types we care about)
      const conditionTypes = new Set(
        rule.expectedTransitions.map((t) => t.conditionType)
      );

      const relevantTransitions = actual
        .map((t) => ({
          ...t,
          conditions: t.conditions.filter((c) => conditionTypes.has(c.type as any)),
        }))
        .filter((t) => t.conditions.length > 0);

      // Compare with expected
      if (rule.strictCount) {
        if (relevantTransitions.length !== rule.expectedTransitions.length) {
          errors.push(
            `❌ Expected exactly ${rule.expectedTransitions.length} transitions, ` +
              `but got ${relevantTransitions.length}`
          );
        }
      }

      for (let i = 0; i < rule.expectedTransitions.length; i++) {
        const expected = rule.expectedTransitions[i];

        if (i >= relevantTransitions.length) {
          errors.push(
            `❌ Expected transition ${i + 1} not found: ` +
              `${expected.conditionType}=${expected.status}` +
              (expected.reason ? `, reason=${expected.reason}` : '')
          );
          continue;
        }

        const actualTransition = relevantTransitions[i];
        const actualCondition = actualTransition.conditions.find(
          (c) => c.type === expected.conditionType
        );

        if (!actualCondition) {
          errors.push(
            `❌ Transition ${i + 1}: Missing ${expected.conditionType} condition`
          );
          continue;
        }

        // Check status
        if (actualCondition.status !== expected.status) {
          errors.push(
            `❌ Transition ${i + 1}: ${expected.conditionType} status mismatch. ` +
              `Expected: ${expected.status}, Actual: ${actualCondition.status}`
          );
        }

        // Check reason (if specified)
        if (expected.reason && actualCondition.reason !== expected.reason) {
          errors.push(
            `❌ Transition ${i + 1}: ${expected.conditionType} reason mismatch. ` +
              `Expected: ${expected.reason}, Actual: ${actualCondition.reason}`
          );
        }

        // Check message contains (if specified)
        if (expected.messageContains) {
          if (!actualCondition.message.includes(expected.messageContains)) {
            errors.push(
              `❌ Transition ${i + 1}: ${expected.conditionType} message should contain "${expected.messageContains}". ` +
                `Actual: "${actualCondition.message.substring(0, 100)}..."`
            );
          }
        }

        // Check message NOT contains (if specified)
        if (expected.messageNotContains) {
          if (actualCondition.message.includes(expected.messageNotContains)) {
            errors.push(
              `❌ Transition ${i + 1}: ${expected.conditionType} message should NOT contain "${expected.messageNotContains}". ` +
                `Actual: "${actualCondition.message.substring(0, 100)}..."`
            );
          }
        }
      }

      // Check for extra transitions if not allowed
      if (!rule.allowExtraTransitions && relevantTransitions.length > rule.expectedTransitions.length) {
        warnings.push(
          `⚠️  Found ${relevantTransitions.length - rule.expectedTransitions.length} extra transition(s) ` +
            `beyond the expected ${rule.expectedTransitions.length}`
        );
      }
    }

    // Analyze timing if we have transitions
    let timing: ValidationResult['timing'] | undefined;
    if (actual.length >= 2) {
      const conditionType = rule.expectedTransitions[0]?.conditionType || 'Ready';
      timing = this.analyzeTiming(actual, conditionType);

      // Check timing constraints
      if (timing && rule.maxTotalDurationSec) {
        if (timing.totalDurationSec > rule.maxTotalDurationSec) {
          errors.push(
            `❌ Total transition duration (${timing.totalDurationSec.toFixed(1)}s) ` +
              `exceeds maximum (${rule.maxTotalDurationSec}s)`
          );
        }
      }

      if (timing && rule.maxTransitionDurationSec) {
        for (const t of timing.transitionTimings) {
          if (t.durationSec > rule.maxTransitionDurationSec) {
            warnings.push(
              `⚠️  Slow transition detected: ${t.fromReason} → ${t.toReason} ` +
                `took ${t.durationSec.toFixed(1)}s (max: ${rule.maxTransitionDurationSec}s)`
            );
          }
        }
      }
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      actualTransitionCount: actual.length,
      expectedTransitionCount: rule.expectedTransitions.length,
      actualTransitions: actual,
      timing,
    };
  }

  /**
   * Common validation rule: No optimistic lock conflict flickers
   */
  static noOptimisticLockFlickers(): Partial<TransitionValidationRule> {
    return {
      forbiddenTransitions: [
        {
          conditionType: 'Ready',
          status: 'False',
          reason: 'DeploymentUnavailable',
          messageContains: 'object has been modified',
        },
        {
          conditionType: 'Ready',
          status: 'False',
          reason: 'DeploymentUnavailable',
          messageContains: 'Operation cannot be fulfilled',
        },
      ],
    };
  }

  /**
   * Format validation result for console output
   */
  static formatResult(result: ValidationResult): string {
    const lines: string[] = [];

    lines.push(`📊 Transition Validation Results:`);
    lines.push(`   Transitions captured: ${result.actualTransitionCount}`);
    lines.push(`   Transitions expected: ${result.expectedTransitionCount}`);

    // Add timing information if available
    if (result.timing) {
      lines.push(`   Total duration: ${result.timing.totalDurationSec.toFixed(1)}s`);
      if (result.timing.slowestTransition) {
        const t = result.timing.slowestTransition;
        lines.push(
          `   Slowest transition: ${t.fromReason} → ${t.toReason} ` +
            `(${t.durationSec.toFixed(1)}s)`
        );
      }
    }

    lines.push('');

    if (result.errors.length > 0) {
      lines.push(`❌ FAILED with ${result.errors.length} error(s):`);
      result.errors.forEach((err) => lines.push(`   ${err}`));
      lines.push('');
    }

    if (result.warnings.length > 0) {
      lines.push(`⚠️  ${result.warnings.length} warning(s):`);
      result.warnings.forEach((warn) => lines.push(`   ${warn}`));
      lines.push('');
    }

    if (result.passed) {
      lines.push(`✅ All validations passed!`);
    }

    return lines.join('\n');
  }
}

export interface TransitionTiming {
  fromSequence: number;
  toSequence: number;
  fromTimestamp: string;
  toTimestamp: string;
  durationMs: number;
  durationSec: number;
  fromReason: string;
  toReason: string;
}

export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  actualTransitionCount: number;
  expectedTransitionCount: number;
  actualTransitions: ActualTransition[];
  timing?: {
    totalDurationMs: number;
    totalDurationSec: number;
    transitionTimings: TransitionTiming[];
    slowestTransition?: TransitionTiming;
  };
}
