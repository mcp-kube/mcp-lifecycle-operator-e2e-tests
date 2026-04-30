# MCPServer CRD Test Coverage Gap Analysis

**Date:** 2026-04-30
**Operator Repository:** https://github.com/kubernetes-sigs/mcp-lifecycle-operator (main branch)
**CRD:** `mcp.x-k8s.io/v1alpha1/MCPServer`
**Last Analyzed Commit:** `4f962ebe0987e1e327a155366da73229aab3a357` (2026-04-29, "Wire EventRecorder into MCPServer reconciler (#118)")

## Summary

This report identifies MCPServer CRD spec fields and controller behaviors that are not yet exercised by the e2e test suites under `test-servers/`. The analysis compares the full CRD schema (from `config/crd/bases/mcp.x-k8s.io_mcpservers.yaml` and `api/v1alpha1/mcpserver_types.go`) against features tested across all test suites: `operator-features`, `error-conditions`, `update-operations`, and `kubernetes-mcp-server`.

---

## Currently Covered Features

The following areas have good or complete coverage:

| Area                     | Fields Tested                                                                                                                              |
|--------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| **Source**               | `type: ContainerImage`, `containerImage.ref`                                                                                               |
| **Config**               | `port`, `path` (custom), `arguments`                                                                                                       |
| **Env (value)**          | Plain `value`                                                                                                                              |
| **Env (valueFrom)**      | `secretKeyRef`, `configMapKeyRef`, `fieldRef` (5 field paths), `resourceFieldRef` (4 resources)                                            |
| **EnvFrom**              | `secretRef`, `configMapRef`, with and without `prefix`, `optional` flag                                                                    |
| **Storage types**        | `ConfigMap`, `Secret`, `EmptyDir` (default, Memory medium, sizeLimit)                                                                      |
| **Storage options**      | `defaultMode`, `items` (key projection), `optional`, `ReadOnly`/`ReadWrite` permissions                                                    |
| **Runtime**              | `replicas` (0, 1, 2, 3), `resources` (requests + limits for cpu/memory)                                                                    |
| **Health**               | `livenessProbe` and `readinessProbe` via `httpGet` with all timing fields                                                                  |
| **Security (pod)**       | `runAsUser`, `runAsGroup`, `fsGroup`, `runAsNonRoot`, `seccompProfile.type: RuntimeDefault`                                                |
| **Security (container)** | `readOnlyRootFilesystem`, `allowPrivilegeEscalation`, `capabilities.drop`                                                                  |
| **Security (other)**     | `serviceAccountName`                                                                                                                       |
| **Status**               | `conditions` (Accepted/Ready with all reasons), `observedGeneration`, `deploymentName`, `serviceName`, `address.url`, `lastTransitionTime` |

---

## Recent Operator Changes (Behavioral Features from PRs)

These are controller behavioral features introduced by recent PRs that are not yet covered by e2e tests. They don't necessarily correspond to new CRD fields, but to new controller logic.

### ~~B1. Default TCP Readiness Probe Injection (PR #111, issue #110)~~ -- COVERED

**Merged:** 2026-04-28
**Covered by:** `test-servers/behavioral-features/` (test `01-default-tcp-readiness-probe`)
**Verifies:** Controller injects tcpSocket readiness probe targeting `spec.config.port` when no custom probe is specified. Also verifies MCPServer reaches `Ready=True, Available`.

### ~~B2. MCP Protocol Handshake Validation (PR #111, issue #110)~~ -- COVERED

**Merged:** 2026-04-28
**Covered by:** `test-servers/behavioral-features/` (tests `02-mcp-handshake-validation`)
**Verifies:** When the MCP handshake fails (server doesn't serve MCP at the configured path), `Ready=False` with reason `MCPEndpointUnavailable` and message containing "MCP endpoint is not serving a valid MCP protocol". Also tests recovery: fixing the path causes `Ready=True, Available`.

### ~~B3. Config-Hash Rolling Update on Secret/ConfigMap Change (PR #140, issue #139, #95)~~ -- COVERED

**Merged:** 2026-04-29
**Covered by:** `test-servers/behavioral-features/` (test `03-config-hash-rolling-update`) and `error-conditions` (ConfigMap/Secret update watch tests)
**Verifies:** Deploying an MCPServer referencing a ConfigMap, updating the ConfigMap data, and confirming: config-hash annotation changes, pods are rolled (new pods created, old pods terminated), and MCPServer recovers to `Ready=True, Available`.

### ~~B4. Kubernetes Event Recording (PR #118, issue #109)~~ -- COVERED

**Merged:** 2026-04-29
**Covered by:** `test-servers/behavioral-features/` (tests `04-event-recording-valid` and `04-event-recording-invalid`)
**Verifies:** Normal event (reason=`Valid`, action=`ConfigurationAccepted`, note mentioning `Accepted=True`) emitted on valid configuration. Warning event (reason=`Invalid`, action=`ConfigurationValidation`, note mentioning missing ConfigMap) emitted on validation failure.
**Note:** Issue #109 is still open -- more event types (Ready transitions, deployment problems, etc.) are planned as follow-up PRs.

### ~~B5. Custom Prometheus Metrics (PR #122, issue #100)~~ -- COVERED

**Merged:** 2026-04-28
**Covered by:** `test-servers/behavioral-features/` (test `05-metrics-valid` and `05-metrics-invalid`)
**Verifies:** Deploys valid and invalid MCPServers, then scrapes the operator's `/metrics` endpoint (via port-forward with RBAC auth) and confirms:
- `mcpserver_condition_info` gauge has correct labels for both servers (Accepted/Ready with status and reason)
- `mcpserver_validation_failures_total` counter is incremented for invalid config
- `mcpserver_reconcile_phase_duration_seconds` histogram has validation phase data

### ~~B6. Env valueFrom Validation in Accepted Condition (PR #103)~~ -- COVERED

**Merged:** 2026-04-17
**Covered by:** `test-servers/behavioral-features/` (tests `06-env-valuefrom-missing-secret`, `06-env-valuefrom-missing-configmap`, `06-env-valuefrom-optional-secret`)
**Verifies:** Missing `secretKeyRef` reference causes `Accepted=False, Invalid` with message mentioning secret name and "env var". Missing `configMapKeyRef` reference causes `Accepted=False, Invalid` with message mentioning configmap name and "env var". `optional: true` on `secretKeyRef` skips validation and allows `Accepted=True, Valid` despite missing Secret.

### B7. Transient vs Permanent Error Distinction (PR #107, issue #86)

**Merged:** 2026-04-23
**Behavior:** Transient API errors (network timeouts, server errors) during validation no longer flip `Accepted` to `False`. Only permanent configuration errors (missing ConfigMap/Secret that the API confirms doesn't exist) set `Accepted=False`. Transient errors trigger requeue without status changes.
**What to test:** Difficult to test in e2e (requires simulating API server errors). The behavior is implicitly validated by existing tests that confirm Accepted doesn't flicker.
**Testability:** Low (for e2e)

---

## Gaps: CRD Field Coverage

### 1. Storage: `RecursiveReadOnly` Permission

**CRD field:** `spec.config.storage[].permissions`
**Enum values:** `ReadOnly`, `ReadWrite`, `RecursiveReadOnly`
**What's missing:** Only `ReadOnly` and `ReadWrite` are tested. `RecursiveReadOnly` (mount and all submounts are recursively read-only) is not exercised.
**Testability:** High -- add a storage mount with `permissions: RecursiveReadOnly` and verify the mount and any subdirectories are read-only.

### 2. Storage: Item-Level File Mode

**CRD field:** `spec.config.storage[].source.configMap.items[].mode` and `spec.config.storage[].source.secret.items[].mode`
**What's missing:** Volume-level `defaultMode` is tested, but per-item `mode` overrides on individual key projections are not.
**Testability:** High -- add `mode` to existing item projections and verify individual file permissions differ from the volume default.

### 3. Health Probes: `exec` Type

**CRD field:** `spec.runtime.health.livenessProbe.exec` / `spec.runtime.health.readinessProbe.exec`
**What's missing:** Only `httpGet` probes are tested. Command-based `exec` probes (`command: [...]`) are not exercised.
**Testability:** High -- configure an exec probe that runs a command (e.g., `cat /tmp/healthy`) and verify the pod stays running.

### 4. Health Probes: `tcpSocket` Type

**CRD field:** `spec.runtime.health.livenessProbe.tcpSocket` / `spec.runtime.health.readinessProbe.tcpSocket`
**What's missing:** TCP socket-based health checks (`port`, `host`) are not tested.
**Testability:** High -- configure a tcpSocket probe targeting the MCP server's port and verify pod health.

### 5. Health Probes: `grpc` Type

**CRD field:** `spec.runtime.health.livenessProbe.grpc` / `spec.runtime.health.readinessProbe.grpc`
**What's missing:** gRPC-based health checks (`port`, `service`) are not tested.
**Testability:** Low -- requires the test server to implement the gRPC health checking protocol.

### 6. Health Probes: `terminationGracePeriodSeconds`

**CRD field:** `spec.runtime.health.livenessProbe.terminationGracePeriodSeconds` / `spec.runtime.health.readinessProbe.terminationGracePeriodSeconds`
**What's missing:** Per-probe override of the pod's termination grace period is not tested.
**Testability:** Medium -- can be configured but difficult to verify behaviorally without inducing probe failures.

### 7. Security: `podSecurityContext.supplementalGroups`

**CRD field:** `spec.runtime.security.podSecurityContext.supplementalGroups`
**What's missing:** Additional group IDs for the pod's processes are not tested.
**Testability:** High -- set `supplementalGroups: [4000, 5000]` and verify via the `check_user_id` tool that the process has those group memberships.

### 8. Security: `podSecurityContext.fsGroupChangePolicy`

**CRD field:** `spec.runtime.security.podSecurityContext.fsGroupChangePolicy`
**Enum values:** `OnRootMismatch`, `Always`
**What's missing:** The policy controlling when fsGroup ownership is applied to volumes is not tested.
**Testability:** Medium -- can be configured, but behavioral verification (whether ownership is actually changed) depends on volume state.

### 9. Security: `podSecurityContext.seLinuxOptions`

**CRD field:** `spec.runtime.security.podSecurityContext.seLinuxOptions` (user, role, type, level)
**What's missing:** SELinux label configuration is not tested.
**Testability:** Low -- requires an SELinux-enabled cluster (not available on most test environments).

### 10. Security: `podSecurityContext.appArmorProfile`

**CRD field:** `spec.runtime.security.podSecurityContext.appArmorProfile` (type, localhostProfile)
**What's missing:** AppArmor profile configuration at the pod level is not tested.
**Testability:** Low -- requires an AppArmor-enabled node.

### 11. Security: `podSecurityContext.sysctls`

**CRD field:** `spec.runtime.security.podSecurityContext.sysctls` (name, value)
**What's missing:** Kernel parameter tuning via sysctls is not tested.
**Testability:** Low -- requires allowed sysctls in the cluster's PodSecurityPolicy/Standards configuration.

### 12. Security: `podSecurityContext.supplementalGroupsPolicy`

**CRD field:** `spec.runtime.security.podSecurityContext.supplementalGroupsPolicy`
**Enum values:** `Merge`, `Strict`
**What's missing:** Policy for how supplemental groups are computed is not tested.
**Testability:** Medium -- requires Kubernetes 1.31+ and verification of group membership behavior.

### 13. Security: Container-Level `runAsUser` / `runAsGroup` / `runAsNonRoot`

**CRD field:** `spec.runtime.security.securityContext.runAsUser`, `.runAsGroup`, `.runAsNonRoot`
**What's missing:** These fields are only tested at the pod level (`podSecurityContext`). Container-level overrides are not exercised.
**Testability:** High -- set container-level values that differ from pod-level values and verify the container runs with the container-level settings.

### 14. Security: `securityContext.privileged`

**CRD field:** `spec.runtime.security.securityContext.privileged`
**What's missing:** Privileged container mode is not tested.
**Testability:** Medium -- can be set to `false` (explicit) and verified, but `true` may be restricted by cluster policy.

### 15. Security: `securityContext.procMount`

**CRD field:** `spec.runtime.security.securityContext.procMount`
**What's missing:** Process mount type configuration is not tested.
**Testability:** Low -- limited practical use cases and requires specific cluster configuration.

### 16. Security: Container-Level `seccompProfile`

**CRD field:** `spec.runtime.security.securityContext.seccompProfile` (type, localhostProfile)
**What's missing:** Only pod-level `seccompProfile` is tested. Container-level override is not exercised.
**Testability:** Medium -- can set a different profile at the container level and verify it takes effect.

### 17. Security: Container-Level `appArmorProfile`

**CRD field:** `spec.runtime.security.securityContext.appArmorProfile` (type, localhostProfile)
**What's missing:** AppArmor profile at the container level is not tested.
**Testability:** Low -- requires AppArmor-enabled nodes.

### 18. Env: `secretKeyRef.optional` / `configMapKeyRef.optional`

**CRD field:** `spec.config.env[].valueFrom.secretKeyRef.optional` and `spec.config.env[].valueFrom.configMapKeyRef.optional`
**What's missing:** The `optional` flag on individual env var key references is tested for `envFrom` and storage but not for individual `env[].valueFrom` references.
**Testability:** High -- reference a non-existent ConfigMap/Secret key with `optional: true` and verify the pod starts successfully without that env var.

### 19. Env: `resourceFieldRef.divisor`

**CRD field:** `spec.config.env[].valueFrom.resourceFieldRef.divisor`
**What's missing:** Custom divisor for resource field references (e.g., expressing memory in MiB instead of bytes) is not tested.
**Testability:** High -- set `divisor: "1Mi"` on a memory resourceFieldRef and verify the env var contains the value in MiB.

### 20. Env: `resourceFieldRef.containerName`

**CRD field:** `spec.config.env[].valueFrom.resourceFieldRef.containerName`
**What's missing:** Explicit container name targeting for resource field references is not tested.
**Testability:** Medium -- useful primarily in multi-container pods; may not apply to single-container MCPServer pods.

### 21. Resources: `claims` (Dynamic Resource Allocation)

**CRD field:** `spec.runtime.resources.claims` (name, request)
**What's missing:** DRA resource claims are not tested.
**Testability:** Low -- requires DRA-enabled cluster with resource drivers installed. This is a relatively new and uncommon feature.

---

## Open Feature Issues (Upcoming Changes)

These open issues in the operator repository may introduce new features that will need test coverage:

| Issue                                                                        | Title                                                            | Impact                                                                                       |
|------------------------------------------------------------------------------|------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| [#109](https://github.com/kubernetes-sigs/mcp-lifecycle-operator/issues/109) | Emit Kubernetes events in various cases                          | More event types coming (Ready transitions, deployment problems, etc.). PR #118 was partial. |
| [#88](https://github.com/kubernetes-sigs/mcp-lifecycle-operator/issues/88)   | Improve Ready condition messages with pod failure details        | Better error messages in Ready condition                                                     |
| [#87](https://github.com/kubernetes-sigs/mcp-lifecycle-operator/issues/87)   | Ready condition flickers for transient optimistic lock conflicts | Bug fix for condition stability                                                              |
| [#7](https://github.com/kubernetes-sigs/mcp-lifecycle-operator/issues/7)     | Add support for labels and annotations                           | New CRD fields for custom labels/annotations                                                 |
| [#6](https://github.com/kubernetes-sigs/mcp-lifecycle-operator/issues/6)     | Add server capabilities/protocol version to status               | New status fields                                                                            |
| [#13](https://github.com/kubernetes-sigs/mcp-lifecycle-operator/issues/13)   | Workload support for DaemonSet, StatefulSet                      | New source/workload types                                                                    |
| [#11](https://github.com/kubernetes-sigs/mcp-lifecycle-operator/issues/11)   | BYO resources and reference them                                 | Bring-your-own Deployment/Service                                                            |
| [#125](https://github.com/kubernetes-sigs/mcp-lifecycle-operator/issues/125) | MCP gateway(s) integration(s)                                    | Gateway integration                                                                          |

---

## Recommended Priority

Based on testability and coverage impact, the recommended implementation order is:

### High Priority -- Behavioral Features (new controller logic, easy to test)
1. ~~**B1.** Default TCP readiness probe injection (no custom probe specified)~~ -- DONE
2. ~~**B2.** MCP handshake validation / `MCPEndpointUnavailable` condition reason~~ -- DONE
3. ~~**B3.** Config-hash rolling update on Secret/ConfigMap data change~~ -- DONE
4. ~~**B4.** Kubernetes Event recording (Normal on Accepted=True, Warning on validation failure)~~ -- DONE

### High Priority -- CRD Fields (easy to test, meaningful coverage)
5. `RecursiveReadOnly` storage permission
6. `exec` health probe type
7. `tcpSocket` health probe type
8. Container-level `runAsUser` / `runAsGroup` / `runAsNonRoot` overrides
9. `supplementalGroups` in pod security context
10. `secretKeyRef.optional` / `configMapKeyRef.optional` on env vars
11. `resourceFieldRef.divisor`
12. Item-level `mode` on storage projections

### Medium Priority (testable with some caveats)
13. ~~Prometheus metrics verification (B5)~~ -- DONE
14. `fsGroupChangePolicy`
15. `supplementalGroupsPolicy`
16. `terminationGracePeriodSeconds` on probes
17. Container-level `seccompProfile`
18. `privileged: false` (explicit)

### Low Priority (environment-dependent or limited value)
19. `grpc` health probe type
20. `seLinuxOptions`
21. `appArmorProfile` (pod and container level)
22. `sysctls`
23. `procMount`
24. `resourceFieldRef.containerName`
25. `resources.claims` (DRA)
