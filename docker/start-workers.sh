#!/usr/bin/env bash
# Entry point for the background-worker service (see docker/Dockerfile.backend).
# Runs the long-lived processes from backend/src/workers/Procfile — the
# job-queue worker, the AIMD rate controller, and (unless disabled) the
# example-sentence pre-generation worker — in one container. If any exits,
# the container exits non-zero so the platform restarts the set together.
set -uo pipefail
cd "$(dirname "$0")/.."

python -m src.workers.controller &
python -m src.workers.worker &
if [ "${SENTENCE_WORKER_ENABLED:-1}" = "1" ]; then
  python -m src.workers.sentence_worker &
fi

wait -n
status=$?
echo "a worker process exited with status ${status}; shutting the rest down" >&2
kill $(jobs -p) 2>/dev/null
wait
exit "${status}"
