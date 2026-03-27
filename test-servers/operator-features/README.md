# Operator Features Test

This test validates that the MCP Lifecycle Operator correctly implements various Kubernetes features.

## Custom MCP Server

This test uses a custom Node.js MCP server (`server/`) that provides validation tools:

### MCP Tools Provided

- `check_file_exists` - Check if a file exists and return its content
- `test_directory_writable` - Test if a directory is writable by creating/deleting a test file
- `get_env_var` - Get environment variable values
- `check_user_id` - Get current UID, GID, and groups
- `list_directory` - List files in a directory with details
- `get_file_permissions` - Get file permissions and ownership
- `get_process_arguments` - Get process command line arguments
- `get_service_account_info` - Verify ServiceAccount token is mounted (confirms custom SA is configured)

## What This Tests

### Configuration Features
- **Command line arguments**:
  - Multiple arguments with different formats (`--verbose`, `--feature-flag`, `test-mode`, `--config-value=123`)
  - Validates arguments are passed to the container process

- **Custom HTTP path**:
  - Custom MCP endpoint path: `/custom/test/path` (default is `/mcp`)
  - Validates the operator correctly configures the custom path
  - MCP server listens on the specified custom path

### Storage Features
- **Secret mounting (ReadOnly)**:
  - `secret-for-mounting` mounted at `/mounted-secret` with clearly named files
- **ConfigMap mounting (ReadOnly)**:
  - `configmap-for-mounting` mounted at `/mounted-configmap` with clearly named files
- **ConfigMap with ReadWrite permission**:
  - `configmap-for-writable-mount` mounted at `/writable-directory`
  - Permission: ReadWrite (operator correctly omits `readOnly` flag from mount)
  - **Note**: ConfigMap/Secret volumes in Kubernetes are inherently read-only at the filesystem level
  - Tests verify the operator correctly processes the ReadWrite permission setting
  - Actual filesystem writes are not possible due to Kubernetes limitations

- **Selective key projection (items)**:
  - **Secret projection**: `secret-for-projection` mounted at `/projected-secret`
    - Projects only 2 out of 4 keys to custom paths (`custom/path/secret-file-1.txt`, `custom/path/secret-file-2.txt`)
    - Excludes `key-not-projected` and `another-excluded-key`
  - **ConfigMap projection**: `configmap-for-projection` mounted at `/projected-configmap`
    - Projects only 2 out of 4 keys to custom paths (`custom/path/configmap-file-1.conf`, `custom/path/configmap-file-2.conf`)
    - Excludes `key-not-projected` and `another-excluded-key`
  - Tests verify only specified keys are mounted at custom paths, excluded keys are not present

- **Custom file permissions (defaultMode)**:
  - **Secret with restrictive permissions**: `secret-for-permissions` mounted at `/secret-with-permissions`
    - defaultMode: 0400 (read-only by owner)
    - Use case: Sensitive files like API keys, certificates
    - Tests verify all files have 0440 permissions (Kubernetes adds group read when fsGroup is set)
    - **Note**: fsGroup (2000) adds group read permission to secret volumes (documented Kubernetes behavior)
  - **ConfigMap with executable permissions**: `configmap-for-permissions` mounted at `/configmap-with-permissions`
    - defaultMode: 0755 (read/execute for all, write for owner)
    - Use case: Scripts that need to be executable
    - Tests verify all files have 0755 permissions

- **EmptyDir volumes (scratch space)**:
  - **Default medium (disk-backed)**: EmptyDir mounted at `/emptydir-default`
    - No configuration (uses default disk-backed storage)
    - Truly writable (unlike ConfigMap/Secret volumes)
    - Use case: Temporary files, caches, processing workspace
  - **Memory medium (tmpfs)**: EmptyDir mounted at `/emptydir-memory`
    - medium: Memory (uses tmpfs for fast temporary storage)
    - sizeLimit: 64Mi (prevents memory exhaustion)
    - Use case: Fast temporary storage for in-memory processing
  - **Disk-backed with size limit**: EmptyDir mounted at `/emptydir-with-size`
    - sizeLimit: 128Mi (prevents disk exhaustion)
    - Use case: Temporary storage with capacity control
  - **Tests verify**:
    - EmptyDir directories exist and are accessible
    - Files can be created, written, and deleted (true writability)
    - Different medium types (default disk vs Memory) work correctly
    - Size limits are properly configured

### Environment Variables
- **Environment variables from multiple sources**:
  - Plain environment variable: `plain_env_var`
  - From mounted secret (dual-use): `env_var_from_mounted_secret_key_1`
  - From secret (env-only): `env_var_from_secret_key_1`, `env_var_from_secret_key_2`
  - From mounted configmap (dual-use): `env_var_from_mounted_configmap_key_1`
  - From configmap (env-only): `env_var_from_configmap_key_1`, `env_var_from_configmap_key_2`

- **Bulk environment variable injection (envFrom)**:
  - From secret without prefix: `envfrom-secret-key-1`, `envfrom-secret-key-2`, `envfrom-secret-key-3`
  - From secret with prefix: `PREFIX_prefixed-secret-key-1`, `PREFIX_prefixed-secret-key-2`
  - From configmap without prefix: `envfrom-configmap-key-1`, `envfrom-configmap-key-2`, `envfrom-configmap-key-3`
  - From configmap with prefix: `PREFIX_prefixed-configmap-key-1`, `PREFIX_prefixed-configmap-key-2`

- **Environment variables from fieldRef (pod metadata)**:
  - Pod name: `env_var_from_field_pod_name` (from `metadata.name`)
  - Pod namespace: `env_var_from_field_pod_namespace` (from `metadata.namespace`)
  - Pod IP: `env_var_from_field_pod_ip` (from `status.podIP`)
  - Node name: `env_var_from_field_node_name` (from `spec.nodeName`)
  - ServiceAccount: `env_var_from_field_service_account` (from `spec.serviceAccountName`)

- **Environment variables from resourceFieldRef (resource limits/requests)**:
  - CPU limit: `env_var_from_resource_limits_cpu` (from `limits.cpu`)
  - Memory limit: `env_var_from_resource_limits_memory` (from `limits.memory`)
  - CPU request: `env_var_from_resource_requests_cpu` (from `requests.cpu`)
  - Memory request: `env_var_from_resource_requests_memory` (from `requests.memory`)

### Security Features
- **Security context**:
  - `runAsUser: 1000`
  - `runAsGroup: 3000`
  - `fsGroup: 2000`
  - `runAsNonRoot: true`
  - `readOnlyRootFilesystem: false`
  - `allowPrivilegeEscalation: false`
  - Drop ALL capabilities
  - Seccomp profile: RuntimeDefault

### Resource Management
- **Resource requests**: Memory 64Mi, CPU 100m
- **Resource limits**: Memory 128Mi, CPU 200m

### Runtime Configuration
- **Replicas**: 2 pods for testing scaling/HA configuration
- **Custom ServiceAccount**: `custom-mcp-service-account` for RBAC testing
  - Verifies operator correctly configures pod ServiceAccount
  - ServiceAccount token is mounted and accessible

### Health Probes
- **Liveness Probe**: HTTP GET to `/health` endpoint
  - Checks if container should be restarted
  - Configuration: initialDelay=5s, period=10s, timeout=3s, failureThreshold=3
- **Readiness Probe**: HTTP GET to `/ready` endpoint
  - Checks if container can receive traffic
  - Configuration: initialDelay=3s, period=5s, timeout=2s, failureThreshold=3

## How It Works

1. **Build the custom MCP server image** (automated by test scripts)
2. **Load it into Kind cluster** (automated by test scripts)
3. **Deploy MCPServer with operator features configured**
4. **Run tests that call MCP tools** to validate configuration
5. All validation happens through the MCP protocol

The image building and loading is automatically handled by the test framework when you run `./scripts/run-e2e.sh`.

## Test Coverage

### Configuration
- ✅ Command line arguments passed to container
- ✅ Custom HTTP path for MCP endpoint

### Volume Mounts
- ✅ Multiple Secrets mounted at different paths (ReadOnly)
- ✅ Secret files readable with correct contents
- ✅ Multiple ConfigMaps mounted at different paths (ReadOnly)
- ✅ ConfigMap files readable with correct contents
- ✅ Operator correctly processes ReadWrite permission (mount configured without readOnly flag)
- ℹ️  ConfigMap/Secret volumes are inherently read-only in Kubernetes (platform limitation)
- ✅ Selective key projection - only specified keys are mounted
- ✅ Keys projected to custom paths (not default filenames)
- ✅ Excluded keys are not present in mounted volume
- ✅ Custom file permissions (defaultMode) - Secret with 0400, ConfigMap with 0755
- ✅ All files in volume inherit the specified defaultMode
- ℹ️  Secret volumes with fsGroup: Kubernetes adds group read permission (0400 → 0440)
- ✅ EmptyDir volumes (scratch space for temporary files)
- ✅ EmptyDir with default medium (disk-backed) is mounted and writable
- ✅ EmptyDir with Memory medium (tmpfs) for fast temporary storage
- ✅ EmptyDir with sizeLimit to prevent disk/memory exhaustion
- ✅ Files can be created, written, and deleted in EmptyDir (true writability)

### Environment Variables
- ✅ Plain environment variables work
- ✅ Environment variables from multiple Secrets
- ✅ Environment variables from multiple ConfigMaps
- ✅ All sources (plain, Secret, ConfigMap) work simultaneously
- ✅ Bulk injection via envFrom (with and without prefix)
- ✅ EnvFrom from Secrets (with and without prefix)
- ✅ EnvFrom from ConfigMaps (with and without prefix)
- ✅ Environment variables from fieldRef (pod metadata)
- ✅ Pod name, namespace, IP, node name, and ServiceAccount accessible via fieldRef
- ✅ Environment variables from resourceFieldRef (resource limits/requests)
- ✅ CPU and memory limits/requests accessible via resourceFieldRef

### Security
- ✅ Security context UID/GID correct
- ✅ fsGroup applied to mounted files
- ✅ Custom ServiceAccount configured and mounted

### Runtime
- ✅ Replica count configured (2 replicas)
- ✅ ServiceAccount token mounted correctly

### Health Probes
- ✅ Liveness probe (HTTP GET) configured and responding
- ✅ Readiness probe (HTTP GET) configured and responding
- ✅ Probe timing parameters (initialDelaySeconds, periodSeconds, timeoutSeconds, etc.)

## Advantages

- Tests through MCP protocol (not kubectl exec)
- Validates that the MCP server can access configured resources
- Custom tools purpose-built for validation
- More aligned with MCP testing philosophy