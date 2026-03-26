# GitHub Actions Workflows

This directory contains GitHub Actions workflows for the MCP E2E testing framework.

## Workflows

### [`e2e-tests.yaml`](./e2e-tests.yaml)

Runs the complete E2E test suite.

**Triggers:**
- Push to `main` branch
- Pull requests to `main` branch
- Daily schedule at 2 AM UTC
- Manual workflow dispatch

**Jobs:**

1. **e2e-tests**
   - Runs on all triggers
   - Sets up complete test environment (Node.js, Docker, kubectl, kind)
   - Executes all E2E tests
   - Uploads test logs on failure

2. **e2e-tests-operator-ref**
   - Runs only on schedule or manual trigger
   - Tests against different operator branches
   - Uses matrix strategy for parallel testing
   - Useful for compatibility validation

**Environment Variables:**
- `OPERATOR_REF`: Operator git ref to test against (default: `main`)
- `NO_COLOR`: Disable color output for cleaner CI logs (set to `1`)

**Artifacts:**
- `e2e-test-logs`: Complete test logs on failure (7 day retention)

### [`validate.yaml`](./validate.yaml)

Fast validation checks for PRs.

**Triggers:**
- Push to `main` branch
- Pull requests to `main` branch

**Jobs:**

1. **validate-scripts**
   - Checks shell scripts are executable
   - Runs shellcheck for script quality
   - Validates YAML syntax

2. **validate-framework**
   - Installs framework dependencies
   - Checks TypeScript compilation
   - Runs linting (if configured)

3. **validate-test-servers**
   - Validates test server directory structure
   - Ensures required files exist
   - Checks file permissions

## Usage

### Manual Trigger

You can manually trigger the E2E tests workflow from the GitHub Actions UI:

1. Go to the "Actions" tab
2. Select "E2E Tests" workflow
3. Click "Run workflow"
4. Optionally specify operator ref and/or repository:
   - **Testing a PR from the main repo**: Enter `refs/pull/123/head` (replace 123 with PR number)
   - **Testing a branch**: Enter the branch name (e.g., `feature-branch`)
   - **Testing a fork PR**: Enter the fork URL in "Operator repository URL" and the branch name in "Operator git ref"
   - **Testing a commit**: Enter the commit SHA

### Environment Variables

Set these in the workflow file or as repository secrets:

```yaml
env:
  OPERATOR_REF: main        # Operator branch to test
  KEEP_CLUSTER: false       # Keep cluster after tests
  SERVER_READY_TIMEOUT: 300 # Server ready timeout (seconds)
```

## Debugging Failed Runs

1. **Check workflow logs**
   - Navigate to Actions tab
   - Click on the failed run
   - Expand failed job steps

2. **Download test logs artifact**
   - Scroll to bottom of workflow run
   - Download `e2e-test-logs` artifact
   - Extract and review individual server logs

3. **Reproduce locally**
   ```bash
   # Use the same operator ref as CI
   OPERATOR_REF=main ./scripts/run-e2e.sh

   # Keep cluster for debugging
   KEEP_CLUSTER=true ./scripts/run-e2e.sh
   ```

## Adding New Workflows

When adding new workflows:

1. Create workflow file in `.github/workflows/`
2. Use descriptive job names
3. Set appropriate timeouts
4. Add artifact uploads for debugging
5. Document in this README
6. Test manually before merging
