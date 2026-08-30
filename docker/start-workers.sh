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
# Learner definitions for the word cards. Strictly downstream of the sentence
# worker — it defines a lemma using that lemma's own example sentence, so a
# word appears in its backlog only once a sentence exists.
#
# OPT-IN (default off), unlike the workers above. Both spend from the single
# LLM_COST_CAP_USD ledger, and there is no per-worker sub-budget: whichever
# reaches the cap first stops BOTH. Draining the definition backlog is ~$7 of
# a $60 cap that already has ~$40 on it, so switching this on without raising
# the cap would quietly halt sentence generation — and a sentence that never
# gets written is a card that shows nothing at all, where a missing definition
# is one blank line. Set DEFINITION_WORKER_ENABLED=1 once the cap has room.
if [ "${DEFINITION_WORKER_ENABLED:-0}" = "1" ]; then
  python -m src.workers.definition_worker &
fi
# Translation-cache warming (#124). Paced by DeepL's and Google's monthly free
# allowances, so it spends most of its life asleep waiting for a reset.
if [ "${TRANSLATION_WARM_WORKER_ENABLED:-1}" = "1" ]; then
  python -m src.workers.translation_warm_worker &
fi

wait -n
status=$?
echo "a worker process exited with status ${status}; shutting the rest down" >&2
kill $(jobs -p) 2>/dev/null
wait
exit "${status}"
