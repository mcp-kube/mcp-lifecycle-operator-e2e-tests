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
| **Env (valueFrom)**      | `secretKeyRef` (incl. `optional`), `configMapKeyRef` (incl. `optional`), `fieldRef` (5 field paths), `resourceFieldRef` (4 resources + `divisor`) |
| **EnvFrom**              | `secretRef`, `configMapRef`, with and without `prefix`, `optional` flag                                                                    |
| **Storage types**        | `ConfigMap`, `Secret`, `EmptyDir` (default, Memory medium, sizeLimit)                                                                      |
| **Storage options**      | `defaultMode`, `items` (key projection + per-item `mode`), `optional`, `ReadOnly`/`ReadWrite`/`RecursiveReadOnly` permissions                |
| **Runtime**              | `replicas` (0, 1, 2, 3), `resources` (requests + limits for cpu/memory)                                                                    |
| **Health**               | `livenessProbe` and `readinessProbe` via `httpGet`, `exec`, `tcpSocket` with all timing fields                                              |
| **Security (pod)**       | `runAsUser`, `runAsGroup`, `fsGroup`, `runAsNonRoot`, `supplementalGroups`, `seccompProfile.type: RuntimeDefault`                           |
| **Security (container)** | `runAsUser`, `runAsGroup`, `runAsNonRoot` (overrides), `readOnlyRootFilesystem`, `allowPrivilegeEscalation`, `capabilities.drop`             |
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

### ~~B7. Transient vs Permanent Error Distinction (PR #107, issue #86)~~ -- EXCLUDED

**Merged:** 2026-04-23
**Behavior:** Transient API errors (network timeouts, server errors) during validation no longer flip `Accepted` to `False`. Only permanent configuration errors (missing ConfigMap/Secret that the API confirms doesn't exist) set `Accepted=False`. Transient errors trigger requeue without status changes.
**Excluded:** Requires simulating API server errors (fault injection), not feasible in Kind e2e. See `excluded-tests.md`.

---

## Gaps: CRD Field Coverage

### ~~1. Storage: `RecursiveReadOnly` Permission~~ -- COVERED

**CRD field:** `spec.config.storage[].permissions`
**Covered by:** `test-servers/behavioral-features/` (test `07-recursive-readonly-storage`)

### ~~2. Storage: Item-Level File Mode~~ -- COVERED

**CRD field:** `spec.config.storage[].source.configMap.items[].mode` and `spec.config.storage[].source.secret.items[].mode`
**Covered by:** `test-servers/operator-features/` (per-item mode tests on `/secret-item-mode` and `/configmap-item-mode`)

### ~~3. Health Probes: `exec` Type~~ -- COVERED

**CRD field:** `spec.runtime.health.livenessProbe.exec` / `spec.runtime.health.readinessProbe.exec`
**Covered by:** `test-servers/behavioral-features/` (test `08-exec-health-probe`)

### ~~4. Health Probes: `tcpSocket` Type~~ -- COVERED

**CRD field:** `spec.runtime.health.livenessProbe.tcpSocket` / `spec.runtime.health.readinessProbe.tcpSocket`
**Covered by:** `test-servers/behavioral-features/` (test `09-explicit-tcp-health-probe`)

### ~~5. Health Probes: `grpc` Type~~ -- EXCLUDED

**CRD field:** `spec.runtime.health.livenessProbe.grpc` / `spec.runtime.health.readinessProbe.grpc`
**Excluded:** Requires gRPC health checking protocol in test server. See `excluded-tests.md`.

### ~~6. Health Probes: `terminationGracePeriodSeconds`~~ -- EXCLUDED

**CRD field:** `spec.runtime.health.livenessProbe.terminationGracePeriodSeconds` / `spec.runtime.health.readinessProbe.terminationGracePeriodSeconds`
**Excluded:** Timing-based verification is inherently flaky. See `excluded-tests.md`.

### ~~7. Security: `podSecurityContext.supplementalGroups`~~ -- COVERED

**CRD field:** `spec.runtime.security.podSecurityContext.supplementalGroups`
**Covered by:** `test-servers/operator-features/` (supplementalGroups test verifying groups 4000, 5000)

### ~~8. Security: `podSecurityContext.fsGroupChangePolicy`~~ -- EXCLUDED

**CRD field:** `spec.runtime.security.podSecurityContext.fsGroupChangePolicy`
**Excluded:** Both policies produce identical results with fresh mounts. See `excluded-tests.md`.

### ~~9. Security: `podSecurityContext.seLinuxOptions`~~ -- EXCLUDED

**CRD field:** `spec.runtime.security.podSecurityContext.seLinuxOptions` (user, role, type, level)
**Excluded:** Requires SELinux-enabled cluster. See `excluded-tests.md`.

### ~~10. Security: `podSecurityContext.appArmorProfile`~~ -- EXCLUDED

**CRD field:** `spec.runtime.security.podSecurityContext.appArmorProfile` (type, localhostProfile)
**Excluded:** Requires AppArmor-enabled node. See `excluded-tests.md`.

### ~~11. Security: `podSecurityContext.sysctls`~~ -- EXCLUDED

**CRD field:** `spec.runtime.security.podSecurityContext.sysctls` (name, value)
**Excluded:** Requires allowed sysctls in cluster configuration. See `excluded-tests.md`.

### ~~12. Security: `podSecurityContext.supplementalGroupsPolicy`~~ -- EXCLUDED

**CRD field:** `spec.runtime.security.podSecurityContext.supplementalGroupsPolicy`
**Excluded:** Requires container image with custom groups to observe difference. See `excluded-tests.md`.

### ~~13. Security: Container-Level `runAsUser` / `runAsGroup` / `runAsNonRoot`~~ -- COVERED

**CRD field:** `spec.runtime.security.securityContext.runAsUser`, `.runAsGroup`, `.runAsNonRoot`
**Covered by:** `test-servers/behavioral-features/` (test `10-container-security-override`)

### ~~14. Security: `securityContext.privileged`~~ -- EXCLUDED

**CRD field:** `spec.runtime.security.securityContext.privileged`
**Excluded:** `true` is blocked by cluster policy; `false` is already the default. See `excluded-tests.md`.

### ~~15. Security: `securityContext.procMount`~~ -- EXCLUDED

**CRD field:** `spec.runtime.security.securityContext.procMount`
**Excluded:** No observable behavioral difference from MCP server perspective. See `excluded-tests.md`.

### ~~16. Security: Container-Level `seccompProfile`~~ -- EXCLUDED

**CRD field:** `spec.runtime.security.securityContext.seccompProfile` (type, localhostProfile)
**Excluded:** Override pattern already verified by container-level runAsUser/runAsGroup test. See `excluded-tests.md`.

### ~~17. Security: Container-Level `appArmorProfile`~~ -- EXCLUDED

**CRD field:** `spec.runtime.security.securityContext.appArmorProfile` (type, localhostProfile)
**Excluded:** Requires AppArmor-enabled nodes. See `excluded-tests.md`.

### ~~18. Env: `secretKeyRef.optional` / `configMapKeyRef.optional`~~ -- COVERED

**CRD field:** `spec.config.env[].valueFrom.secretKeyRef.optional` and `spec.config.env[].valueFrom.configMapKeyRef.optional`
**Covered by:** `test-servers/operator-features/` (optional secretKeyRef/configMapKeyRef env var tests)

### ~~19. Env: `resourceFieldRef.divisor`~~ -- COVERED

**CRD field:** `spec.config.env[].valueFrom.resourceFieldRef.divisor`
**Covered by:** `test-servers/operator-features/` (divisor 1Mi test verifying value is "128")

### ~~20. Env: `resourceFieldRef.containerName`~~ -- EXCLUDED

**CRD field:** `spec.config.env[].valueFrom.resourceFieldRef.containerName`
**Excluded:** Only relevant for multi-container pods; MCPServer is single-container. See `excluded-tests.md`.

### ~~21. Resources: `claims` (Dynamic Resource Allocation)~~ -- EXCLUDED

**CRD field:** `spec.runtime.resources.claims` (name, request)
**Excluded:** Requires DRA-enabled cluster with resource drivers. See `excluded-tests.md`.

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
5. ~~`RecursiveReadOnly` storage permission~~ -- DONE
6. ~~`exec` health probe type~~ -- DONE
7. ~~`tcpSocket` health probe type~~ -- DONE
8. ~~Container-level `runAsUser` / `runAsGroup` / `runAsNonRoot` overrides~~ -- DONE
9. ~~`supplementalGroups` in pod security context~~ -- DONE
10. ~~`secretKeyRef.optional` / `configMapKeyRef.optional` on env vars~~ -- DONE
11. ~~`resourceFieldRef.divisor`~~ -- DONE
12. ~~Item-level `mode` on storage projections~~ -- DONE

### Medium Priority (testable with some caveats)
13. ~~Prometheus metrics verification (B5)~~ -- DONE
14. ~~`fsGroupChangePolicy`~~ -- EXCLUDED
15. ~~`supplementalGroupsPolicy`~~ -- EXCLUDED
16. ~~`terminationGracePeriodSeconds` on probes~~ -- EXCLUDED
17. ~~Container-level `seccompProfile`~~ -- EXCLUDED
18. ~~`privileged: false` (explicit)~~ -- EXCLUDED

### Low Priority (environment-dependent or limited value)
19. ~~`grpc` health probe type~~ -- EXCLUDED
20. ~~`seLinuxOptions`~~ -- EXCLUDED
21. ~~`appArmorProfile` (pod and container level)~~ -- EXCLUDED
22. ~~`sysctls`~~ -- EXCLUDED
23. ~~`procMount`~~ -- EXCLUDED
24. ~~`resourceFieldRef.containerName`~~ -- EXCLUDED
25. ~~`resources.claims` (DRA)~~ -- EXCLUDED

See `excluded-tests.md` for detailed rationale on each excluded item.
