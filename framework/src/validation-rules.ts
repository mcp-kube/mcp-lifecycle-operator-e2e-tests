/**
 * Pre-built validation rules for common MCPServer status transition scenarios
 * Makes it easier to write tests with standardized expectations
 */

import type { TransitionValidationRule } from './transition-validator.js';
import { TransitionValidator } from './transition-validator.js';

export class ValidationRules {
  /**
   * Happy path: Deployment succeeds and becomes available
   * Expected sequence: Initializing (optional) → Available
   *
   * Use this for tests where the MCPServer should successfully deploy and run.
   */
  static happyPath(): TransitionValidationRule {
    return {
      name: 'Happy path: Deployment becomes Available',
      expectedTransitions: [
        // May see Initializing state (if caught early enough)
        {
          conditionType: 'Ready',
          status: 'Unknown',
          reason: 'Initializing',
        },
        // Should reach Available state
        {
          conditionType: 'Ready',
          status: 'True',
          reason: 'Available',
        },
      ],
      // Forbid optimistic lock conflict flickers
      ...TransitionValidator.noOptimisticLockFlickers(),
      // Allow extra transitions during deployment
      allowExtraTransitions: true,
    };
  }

  /**
   * Deployment failure due to image pull, crash loop, or other pod issues
   * Expected: Ready=False, reason=DeploymentUnavailable
   *
   * @param messageContains - Optional string that should appear in the message
   */
  static deploymentFailure(messageContains?: string): TransitionValidationRule {
    return {
      name: 'Deployment failure: DeploymentUnavailable',
      expectedTransitions: [
        {
          conditionType: 'Ready',
          status: 'False',
          reason: 'DeploymentUnavailable',
          messageContains,
        },
      ],
      // Forbid optimistic lock conflict flickers
      ...TransitionValidator.noOptimisticLockFlickers(),
      // May have multiple transitions as deployment attempts continue
      allowExtraTransitions: true,
    };
  }

  /**
   * Configuration invalid due to missing ConfigMap, Secret, or other validation errors
   * Expected: Accepted=False + Ready=False (reason=ConfigurationInvalid)
   *
   * These errors should be detected immediately without deployment attempts.
   */
  static configurationInvalid(): TransitionValidationRule {
    return {
      name: 'Configuration invalid: Immediate rejection',
      expectedTransitions: [
        // Accepted should be False
        {
          conditionType: 'Accepted',
          status: 'False',
          reason: 'Invalid',
        },
        // Ready should be False with ConfigurationInvalid
        {
          conditionType: 'Ready',
          status: 'False',
          reason: 'ConfigurationInvalid',
          messageContains: 'Configuration must be fixed',
        },
      ],
      // Forbid optimistic lock conflict flickers
      ...TransitionValidator.noOptimisticLockFlickers(),
      // Should be immediate - no extra transitions
      allowExtraTransitions: false,
    };
  }

  /**
   * Server scaled to zero replicas
   * Expected: Ready=True, reason=ScaledToZero (Kubernetes semantics)
   *
   * Per Kubernetes conventions, replicas=0 is a valid desired state,
   * so Ready should be True (not False or Unknown).
   */
  static scaledToZero(): TransitionValidationRule {
    return {
      name: 'Scaled to zero: Ready=True',
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
      // May have extra transitions during scale-down
      allowExtraTransitions: true,
    };
  }

  /**
   * Image pull fails (ImagePullBackOff)
   * Expected: Ready=False, reason=DeploymentUnavailable
   *
   * Specific case of deploymentFailure for image pull errors.
   */
  static imagePullBackOff(): TransitionValidationRule {
    return {
      name: 'ImagePullBackOff: DeploymentUnavailable',
      expectedTransitions: [
        {
          conditionType: 'Ready',
          status: 'False',
          reason: 'DeploymentUnavailable',
        },
      ],
      // Forbid optimistic lock conflict flickers
      ...TransitionValidator.noOptimisticLockFlickers(),
      // May have transitions as image pull is retried
      allowExtraTransitions: true,
    };
  }

  /**
   * Container crashes repeatedly (CrashLoopBackOff)
   * Expected: Ready=False, reason=DeploymentUnavailable
   *
   * Specific case of deploymentFailure for crash loop errors.
   */
  static crashLoopBackOff(): TransitionValidationRule {
    return {
      name: 'CrashLoopBackOff: DeploymentUnavailable',
      expectedTransitions: [
        {
          conditionType: 'Ready',
          status: 'False',
          reason: 'DeploymentUnavailable',
          messageContains: 'healthy',
        },
      ],
      // Forbid optimistic lock conflict flickers
      ...TransitionValidator.noOptimisticLockFlickers(),
      // May have transitions as container restarts
      allowExtraTransitions: true,
    };
  }

  /**
   * Update operation maintains Ready status
   * Expected: Ready stays True throughout the update
   *
   * Use this to verify that spec updates don't cause unnecessary
   * Ready=False transitions (i.e., no "flickering").
   *
   * @param reason - Expected reason (default: 'Available')
   */
  static updateMaintainsReady(reason: string = 'Available'): TransitionValidationRule {
    return {
      name: 'Update maintains Ready=True',
      expectedTransitions: [
        {
          conditionType: 'Ready',
          status: 'True',
          reason,
        },
      ],
      // CRITICAL: No flickers to False during update
      forbiddenTransitions: [
        {
          conditionType: 'Ready',
          status: 'False',
        },
        {
          conditionType: 'Ready',
          status: 'Unknown',
        },
      ],
      // Forbid optimistic lock conflict flickers
      ...TransitionValidator.noOptimisticLockFlickers(),
      // May see multiple True→True transitions as observedGeneration updates
      allowExtraTransitions: true,
    };
  }

  /**
   * Custom validation with common baseline
   * Provides a starting point with optimistic lock protection
   *
   * @param name - Name of the validation rule
   * @param expectedTransitions - Expected transition sequence
   * @param allowExtra - Whether to allow extra transitions (default: true)
   */
  static custom(
    name: string,
    expectedTransitions: TransitionValidationRule['expectedTransitions'],
    allowExtra: boolean = true
  ): TransitionValidationRule {
    return {
      name,
      expectedTransitions,
      // Forbid optimistic lock conflict flickers
      ...TransitionValidator.noOptimisticLockFlickers(),
      allowExtraTransitions: allowExtra,
    };
  }
}
