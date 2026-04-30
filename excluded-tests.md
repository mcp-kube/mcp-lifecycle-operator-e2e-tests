# Excluded Test Cases

This document lists MCPServer CRD fields and controller behaviors that were deliberately excluded from e2e testing, along with the reasoning for each exclusion.

**Date:** 2026-04-30
**Related:** See `gap-analysis-report.md` for full coverage analysis.

---

## Behavioral Features

### B7. Transient vs Permanent Error Distinction (PR #107, issue #86)

**What it does:** Transient API errors (network timeouts, server errors) during validation no longer flip `Accepted` to `False`. Only permanent configuration errors (missing ConfigMap/Secret that the API confirms doesn't exist) set `Accepted=False`. Transient errors trigger requeue without status changes.

**Why excluded:** Requires simulating API server errors (network partitions, 5xx responses), which is not feasible in a standard Kind e2e environment without fault injection infrastructure. The behavior is implicitly validated by existing tests that confirm `Accepted` doesn't flicker during normal operations.

---

## CRD Fields -- Environment Constraints

These fields require specific cluster or node capabilities that are not available in our Kind-based test environment.

### `podSecurityContext.seLinuxOptions`

**CRD field:** `spec.runtime.security.podSecurityContext.seLinuxOptions` (user, role, type, level)

**Why excluded:** Requires an SELinux-enabled cluster. Kind nodes run on the host's kernel and typically do not have SELinux enforcing. Setting SELinux labels on a non-SELinux node has no observable effect, making verification meaningless.

### `podSecurityContext.appArmorProfile` and `securityContext.appArmorProfile`

**CRD fields:** `spec.runtime.security.podSecurityContext.appArmorProfile` and `spec.runtime.security.securityContext.appArmorProfile` (type, localhostProfile)

**Why excluded:** Requires AppArmor-enabled nodes with profiles loaded. Kind nodes inherit the host's AppArmor configuration, which varies by OS (absent on macOS, variable on Linux). No reliable way to verify profile enforcement in CI.

### `podSecurityContext.sysctls`

**CRD field:** `spec.runtime.security.podSecurityContext.sysctls` (name, value)

**Why excluded:** Requires the cluster to allow unsafe sysctls via PodSecurityStandards or kubelet configuration. Kind's default configuration restricts most sysctls, so pods would be rejected by admission rather than testing operator behavior.

### `resources.claims` (Dynamic Resource Allocation)

**CRD field:** `spec.runtime.resources.claims` (name, request)

**Why excluded:** Requires a DRA-enabled cluster with resource drivers installed. DRA is a relatively new feature (GA in Kubernetes 1.32) and requires custom resource drivers that are not available in a standard Kind setup.

---

## CRD Fields -- Verification Difficulty

These fields can be configured in the CRD, but verifying their runtime effect is impractical in e2e tests.

### `terminationGracePeriodSeconds` on probes

**CRD field:** `spec.runtime.health.livenessProbe.terminationGracePeriodSeconds` / `spec.runtime.health.readinessProbe.terminationGracePeriodSeconds`

**Why excluded:** This field overrides the pod's termination grace period when a probe fails. Verifying it would require: (1) inducing a probe failure, (2) measuring the actual termination delay, and (3) comparing it against the configured value. The timing-based verification is inherently flaky and the field is a simple pass-through to the Kubernetes pod spec.

### `podSecurityContext.fsGroupChangePolicy`

**CRD field:** `spec.runtime.security.podSecurityContext.fsGroupChangePolicy` (OnRootMismatch, Always)

**Why excluded:** Controls _when_ fsGroup ownership is applied to volume files. The difference between `Always` and `OnRootMismatch` is only observable when a volume already has files with different ownership (e.g., a PersistentVolumeClaim reused across pods). With our test setup (fresh ConfigMap/Secret/EmptyDir mounts), both policies produce identical results, making behavioral verification impossible.

### `podSecurityContext.supplementalGroupsPolicy`

**CRD field:** `spec.runtime.security.podSecurityContext.supplementalGroupsPolicy` (Merge, Strict)

**Why excluded:** Controls whether container image-defined groups are merged with or replaced by the pod's supplemental groups. Verifying the difference requires a container image that has groups baked into `/etc/group`, and comparing group membership under `Merge` vs `Strict`. Our test validator image doesn't have custom groups in its image layer, so both policies produce the same result.

### `securityContext.procMount`

**CRD field:** `spec.runtime.security.securityContext.procMount`

**Why excluded:** Controls the type of proc mount for the container (`Default` or `Unmasked`). `Unmasked` is restricted by most cluster policies and primarily used for nested container scenarios. There is no observable behavioral difference from the MCP server's perspective, and the field is a direct pass-through to the pod spec.

---

## CRD Fields -- Not Applicable to Single-Container Pods

### `resourceFieldRef.containerName`

**CRD field:** `spec.config.env[].valueFrom.resourceFieldRef.containerName`

**Why excluded:** This field is used to target a specific container's resource limits in multi-container pods. MCPServer pods are single-container, so the field has no practical effect -- `resourceFieldRef` without `containerName` already targets the only container.

---

## CRD Fields -- Partial Coverage Decisions

These fields could be tested but provide diminishing returns given existing coverage.

### `grpc` health probe type

**CRD field:** `spec.runtime.health.livenessProbe.grpc` / `spec.runtime.health.readinessProbe.grpc`

**Why excluded:** Requires the test server to implement the gRPC health checking protocol (`grpc.health.v1.Health`). Our validator server is HTTP-based. Adding gRPC support would require a separate test server image with gRPC dependencies, which is significant effort for testing what is a simple pass-through field. The operator already has coverage for `httpGet`, `exec`, and `tcpSocket` probe types, demonstrating the probe configuration mechanism works correctly.

### `securityContext.privileged`

**CRD field:** `spec.runtime.security.securityContext.privileged`

**Why excluded:** Setting `privileged: true` is blocked by most cluster security policies (including Kind's default PodSecurity). Setting `privileged: false` is the default and already the effective state in all our tests. Explicitly testing `privileged: false` would only verify a default value pass-through.

### Container-level `seccompProfile`

**CRD field:** `spec.runtime.security.securityContext.seccompProfile` (type, localhostProfile)

**Why excluded:** Pod-level `seccompProfile` with `type: RuntimeDefault` is already tested in the operator-features suite. Container-level override is a standard Kubernetes mechanism (container overrides pod) already verified by our container-level `runAsUser`/`runAsGroup` override test. Testing seccomp specifically at the container level would verify the same override pattern with no additional coverage of operator logic.
