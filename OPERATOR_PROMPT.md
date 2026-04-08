# ScaledToZero Condition Semantics Question

## Context

In PR #75, the `Ready` condition uses `ScaledToZero` as a reason when `spec.runtime.replicas=0`, with `status="False"`.

**Current behavior:**
```yaml
apiVersion: mcp.x-k8s.io/v1alpha1
kind: MCPServer
spec:
  runtime:
    replicas: 0
status:
  conditions:
  - type: Ready
    status: "False"           # ❌ False
    reason: ScaledToZero
    message: "Server scaled to 0 replicas"
```

## The Question

Should `Ready=False` when `replicas=0`, or should it follow Kubernetes Deployment semantics where scaling to zero is a valid operational state?

## Comparison with Kubernetes Deployments

When a Deployment is scaled to 0 replicas, Kubernetes sets `Available=True`:

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 0
status:
  conditions:
  - type: Available
    status: "True"            # ✅ True - system is in desired state
    reason: MinimumReplicasAvailable
  replicas: 0
  availableReplicas: 0
```

## Two Perspectives

### Current Approach: `Ready=False, ScaledToZero`
**Rationale:**
- MCPServer's purpose is to serve MCP requests
- Can't serve requests with 0 replicas → not "ready"
- "Ready" means "ready to serve traffic"
- Users immediately see server won't respond to requests

**Pros:**
- Intuitive for users ("not ready" = "won't work")
- Clear operational signal

**Cons:**
- Breaks Kubernetes convention where replicas=0 is a valid desired state
- `Ready=False` usually indicates a problem, but this is intentional configuration
- Inconsistent with how Deployments, StatefulSets, and DaemonSets work

### Alternative Approach: `Ready=True, ScaledToZero`
**Rationale:**
- Replicas=0 is a **valid, intentional** configuration (not an error)
- "Ready" means "system is in desired state and operating correctly"
- Aligns with Kubernetes semantic conventions
- Could introduce separate condition like `ServingTraffic` if needed

**Pros:**
- Consistent with Kubernetes core resource semantics
- Clear separation: conditions indicate health, spec indicates intent
- `Ready=True` confirms operator reconciled correctly
- Users who know Kubernetes patterns understand immediately

**Cons:**
- Less intuitive for users new to Kubernetes
- Need to check both `Ready` condition and status fields to know if server is serving

## Code Location

File: `internal/controller/mcpserver_controller.go`

```go
// Check if scaled to zero
if deployment.Spec.Replicas != nil && *deployment.Spec.Replicas == 0 {
    condition := newCondition(
        ConditionTypeReady,
        metav1.ConditionFalse,    // <-- Should this be True?
        ReasonScaledToZero,
        "Server scaled to 0 replicas",
        generation,
    )
    preserveLastTransitionTime(&condition, existingConditions)
    return condition
}
```

## Request

Please analyze this design decision and provide your recommendation:

1. **Should we change `Ready` to `True` when `ScaledToZero`?**
2. **What are the implications for users and tooling?**
3. **Should we introduce additional conditions** (e.g., `ServingTraffic`) to disambiguate?
4. **What's the best practice alignment with Kubernetes API conventions?**
5. **If we change this, what's the migration strategy?** (This is in PR #75 which hasn't merged yet)

## Additional Context

This came up during E2E test development where we're validating all condition states. The test correctly validates the current behavior, but the question arose: "Shouldn't this follow Kubernetes Deployment semantics?"

Reference: [Kubernetes API Conventions - Typical status properties](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#typical-status-properties)

---

**Your task:** Analyze this thoroughly, provide a recommendation, and if appropriate, implement the change in PR #75 before it merges.
