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

### Environment Variables
- ✅ Plain environment variables work
- ✅ Environment variables from multiple Secrets
- ✅ Environment variables from multiple ConfigMaps
- ✅ All sources (plain, Secret, ConfigMap) work simultaneously
- ✅ Bulk injection via envFrom (with and without prefix)
- ✅ EnvFrom from Secrets (with and without prefix)
- ✅ EnvFrom from ConfigMaps (with and without prefix)

### Security
- ✅ Security context UID/GID correct
- ✅ fsGroup applied to mounted files

## Advantages

- Tests through MCP protocol (not kubectl exec)
- Validates that the MCP server can access configured resources
- Custom tools purpose-built for validation
- More aligned with MCP testing philosophy