# Kubernetes MCP Server

E2E tests for the Kubernetes MCP Server.

## What this server provides

The Kubernetes MCP Server provides MCP tools and resources for interacting with Kubernetes clusters.

- **Tools**: Kubernetes operations (get, list, create, update, delete resources)
- **Resources**: Kubernetes cluster resources (pods, deployments, services, etc.)
- **Prompts**: N/A

## Test coverage

- Server reachability and connection
- Tool listing (core and config toolsets)
- Basic Kubernetes operations
- Resource access validation

## Configuration

The server is configured with:
- Read/write access enabled
- Core and config toolsets
- Denied access to sensitive resources (Secrets, RBAC resources)
- Uses ServiceAccount with cluster-wide edit permissions

## Known issues

None
