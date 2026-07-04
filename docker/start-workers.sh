#!/usr/bin/env bash
# Entry point for the background-worker service (see docker/Dockerfile.backend).
# Runs the two long-lived processes from backend/src/workers/Procfile — the
# job-queue worker and the AIMD rate controller — in one container. If either
# exits, the container exits non-zero so the platform restarts the pair together.
set -uo pipefail
cd "$(dirname "$0")/.."

python -m src.workers.controller &
python -m src.workers.worker &

wait -n
status=$?
echo "worker/controller exited with status ${status}; shutting the pair down" >&2
kill $(jobs -p) 2>/dev/null
wait
exit "${status}"
