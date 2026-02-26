#!/usr/bin/env bash
set -uo pipefail

# run-step.sh — Run all sh block commands for a test step
#
# Usage: e2e/helpers/run-step.sh "cmd1" ["cmd2" ...]
# Skips commands containing <X> or <Y> placeholders (needs-coordinates).
# Exit 0 if all ran commands succeeded, 1 if any failed.

if [ $# -eq 0 ]; then
    echo "Usage: run-step.sh cmd1 [cmd2 ...]" >&2
    exit 1
fi

FAILED=0

for CMD in "$@"; do
    # Skip commands with coordinate placeholders
    if echo "$CMD" | grep -qE '<X>|<Y>'; then
        echo "SKIP  ${CMD}  # needs-coordinates"
        continue
    fi

    # Run the command
    eval "$CMD" >/dev/null 2>&1
    EXIT_CODE=$?

    echo "RAN   ${CMD}  # exit=${EXIT_CODE}"

    if [ $EXIT_CODE -ne 0 ]; then
        FAILED=1
    fi
done

exit $FAILED
