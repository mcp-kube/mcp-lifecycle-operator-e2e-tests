#!/bin/sh
# Simple healthcheck script for exec probe testing
# Exit 0 for success, non-zero for failure

# Check if the server is running by checking if the process is alive
if [ -f /tmp/server-ready ]; then
  exit 0
else
  exit 1
fi
