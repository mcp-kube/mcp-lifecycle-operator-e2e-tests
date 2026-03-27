# Operator Features Test Enhancement Workflow

This document tracks the workflow for continuously enhancing the `operator-features` test to maintain parity with the MCP Lifecycle Operator CRD.

## Workflow Process

When requested, this workflow should:
1. Check out the MCP Lifecycle operator repository main branch
2. Review the CRD (`config/crd/bases/mcp.x-k8s.io_mcpservers.yaml`)
3. Identify features not yet covered by tests
4. Write them down in a document
5. Get approval for which features to add
6. Implement the approved features in `test-servers/operator-features/`

## Operator Repository
- **URL**: https://github.com/kubernetes-sigs/mcp-lifecycle-operator
- **Branch**: main
- **CRD Path**: `/config/crd/bases/mcp.x-k8s.io_mcpservers.yaml`
