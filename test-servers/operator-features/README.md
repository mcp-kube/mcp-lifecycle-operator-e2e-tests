# Operator Features Test

This test validates that the MCP Lifecycle Operator correctly implements various Kubernetes features.

## Custom MCP Server

This test uses a custom Node.js MCP server (`server/`) that provides validation tools:

### MCP Tools Provided

- `check_file_exists` - Check if a file exists and return its content
- `check_directory_writable` - Test if a directory is writable
- `get_env_var` - Get environment variable values
- `check_user_id` - Get current UID, GID, and groups
- `list_directory` - List files in a directory with details
- `get_file_permissions` - Get file permissions and ownership

## What This Tests

### Storage Features
- **Secret mounting**:
  - `secret-for-mounting` mounted at `/mounted-secret` with clearly named files
- **ConfigMap mounting**:
  - `configmap-for-mounting` mounted at `/mounted-configmap` with clearly named files

### Configuration Features
- **Environment variables from multiple sources**:
  - Plain environment variable: `plain_env_var`
  - From mounted secret (dual-use): `env_var_from_mounted_secret_key_1`
  - From secret (env-only): `env_var_from_secret_key_1`, `env_var_from_secret_key_2`
  - From mounted configmap (dual-use): `env_var_from_mounted_configmap_key_1`
  - From configmap (env-only): `env_var_from_configmap_key_1`, `env_var_from_configmap_key_2`

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

### Volume Mounts
- ✅ Multiple Secrets mounted at different paths
- ✅ Secret files readable with correct contents
- ✅ Multiple ConfigMaps mounted at different paths
- ✅ ConfigMap files readable with correct contents

### Environment Variables
- ✅ Plain environment variables work
- ✅ Environment variables from multiple Secrets
- ✅ Environment variables from multiple ConfigMaps
- ✅ All sources (plain, Secret, ConfigMap) work simultaneously

### Security
- ✅ Security context UID/GID correct
- ✅ fsGroup applied to mounted files

## Advantages

- Tests through MCP protocol (not kubectl exec)
- Validates that the MCP server can access configured resources
- Custom tools purpose-built for validation
- More aligned with MCP testing philosophy