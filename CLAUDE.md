# Operator Features Test Enhancement Workflow

This document tracks the workflow for continuously enhancing the `operator-features` test to maintain parity with the MCP Lifecycle Operator CRD.

## Workflow Process

When requested, this workflow should:
1. Check out the MCP Lifecycle operator repository main branch (into `/tmp/mcp-lifecycle-operator`)
2. Check the git log for new commits since the last analyzed commit SHA recorded in `gap-analysis-report.md`
   - If this is the first run (no SHA recorded), review the full history
   - If a previous SHA exists, only review commits newer than that SHA
3. For new commits, check the PRs (number is in commit message) and related issues via `gh` CLI
4. Review the CRD (`config/crd/bases/mcp.x-k8s.io_mcpservers.yaml`) and the controller code to understand the current features and behavior of the operator
5. Identify features not yet covered by tests (tests are under `./test-servers`)
6. Update `gap-analysis-report.md` with findings, including:
   - New behavioral features from recent PRs/commits
   - CRD field coverage gaps
   - Updated "Last Analyzed Commit" SHA at the top of the report
7. Get approval for which features to add
8. Implement the approved features in `test-servers/operator-features/`

## Operator Repository
- **URL**: https://github.com/kubernetes-sigs/mcp-lifecycle-operator
- **Branch**: main
- **CRD Path**: `/config/crd/bases/mcp.x-k8s.io_mcpservers.yaml`
