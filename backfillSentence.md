# SentenceBank Backfill — Plan & Worker Setup

How to populate `sentence_bank` for the **2,748 classified-but-unbanked** movies and leave a worker running while you're away from the laptop.

---

## Scope

| | |
|---|---|
| Total movies in DB | 2,848 |
| Classified | ~2,848 |
| Already banked (any data) | 5 (Hoppers, Spirited Away, Schindler's List, Constantine, Project Hail Mary) |
| Remaining to backfill | **2,748** |
| Per-movie cost | ~2–3s (one spaCy pass + DB writes, **no LLM**) |
| Total cost (sequential) | **~90–150 min** |
| Total cost (4 parallel workers) | **~25–40 min** |

The script is at [`backend/backfill_sentence_bank.py`](backend/backfill_sentence_bank.py) and is already idempotent — re-running just resumes on whichever movies are still unbanked.

---

## Pre-flight checklist

1. **Backend is running.** The script connects to the same Postgres your backend uses; the backend itself doesn't need to be hot, but the DB does.
2. **Use `python3.11`** — Prisma is installed there. `python3` resolves to Apple's 3.9 and will fail with `ImportError`.
3. **`DATABASE_URL`** must be in `backend/.env` (already is).
4. **Free DB connection slot** — the script holds one Prisma connection for the whole run. Default Postgres allows 100 connections; one more is fine.

---

## Worker options, ranked by ease

### Option A — `nohup` on your laptop (fastest to set up)

Survives terminal close but **dies if the laptop sleeps or reboots**. Good for "kick it off, walk away, check tomorrow morning while plugged in."

```bash
cd /Users/tamerlanmustafa/Downloads/wordwise/backend
set -a && source .env && set +a
nohup python3.11 backfill_sentence_bank.py > /tmp/sb-backfill.log 2>&1 &
echo $! > /tmp/sb-backfill.pid

# Watch progress live
tail -f /tmp/sb-backfill.log

# Check status later
ps -p $(cat /tmp/sb-backfill.pid) && echo "still running" || echo "done or crashed"

# Kill if you need to
kill $(cat /tmp/sb-backfill.pid)
```

**Mac sleep gotcha:** in System Settings → Battery → Options, set "Prevent automatic sleeping when display is off" *while plugged in*. Or run `caffeinate -i python3.11 backfill_sentence_bank.py …` instead.

---

### Option B — 4 parallel `nohup` workers (~25 min)

The script supports `--limit`. Combine with a movie-id range filter (small change to the script) or just let four workers race against the same idempotency check — each grabs the next unbanked movie.

**Easier path:** four sequential ranges. Add a `--start-id` / `--end-id` filter to the script (5 lines), then:

```bash
nohup python3.11 backfill_sentence_bank.py --start-id 0    --end-id 750  > /tmp/sb-1.log 2>&1 &
nohup python3.11 backfill_sentence_bank.py --start-id 750  --end-id 1500 > /tmp/sb-2.log 2>&1 &
nohup python3.11 backfill_sentence_bank.py --start-id 1500 --end-id 2200 > /tmp/sb-3.log 2>&1 &
nohup python3.11 backfill_sentence_bank.py --start-id 2200             > /tmp/sb-4.log 2>&1 &
```

Postgres handles 4 concurrent writers fine. spaCy is loaded per process so RAM usage roughly 4× — check Activity Monitor.

**TODO before running:** add the `--start-id` / `--end-id` flags. ~5 lines in `fetch_target_movie_ids`.

---

### Option C — `launchd` on macOS (autonomous, survives reboots)

A `~/Library/LaunchAgents/com.wordwise.sb-backfill.plist`. Runs on login, retries on crash. Best if the laptop reboots or you want the backfill to "just be running."

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.wordwise.sb-backfill</string>
  <key>WorkingDirectory</key>  <string>/Users/tamerlanmustafa/Downloads/wordwise/backend</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/python3.11</string>
    <string>backfill_sentence_bank.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DATABASE_URL</key>
    <string>postgresql://wordwise_user:wordwise_password@localhost:5432/wordwise_db</string>
  </dict>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>  <false/>   <!-- only restart on crash -->
  </dict>
  <key>StandardOutPath</key>   <string>/tmp/sb-backfill.log</string>
  <key>StandardErrorPath</key> <string>/tmp/sb-backfill.err</string>
</dict>
</plist>
```

```bash
launchctl load  ~/Library/LaunchAgents/com.wordwise.sb-backfill.plist
launchctl list | grep sb-backfill
launchctl unload ~/Library/LaunchAgents/com.wordwise.sb-backfill.plist  # to stop
```

The script exits cleanly when all movies are done. `KeepAlive` only restarts on non-zero exit, so a clean finish stays finished.

---

### Option D — Run on whatever hosts the backend (best if remote)

If the backend is deployed somewhere (Railway / Render / Fly / a VPS), drop the script onto that host and run it there. The Postgres is already reachable, the env vars are already set, and the laptop is irrelevant.

Concrete steps depend on the host — common patterns:

- **Railway / Render**: add a one-off "Job" or "Worker" entry that runs `python3.11 backfill_sentence_bank.py`. Same Dockerfile / environment as the backend.
- **VPS with systemd**: `/etc/systemd/system/sb-backfill.service` with `Restart=on-failure`, `WorkingDirectory=/srv/wordwise/backend`, `ExecStart=/usr/bin/python3.11 backfill_sentence_bank.py`.
- **Bare ssh + tmux**: `ssh user@host` → `cd backend && tmux new -d -s sb 'python3.11 backfill_sentence_bank.py'` → walk away.

If you want me to wire this up, tell me where the backend lives.

---

## Resumability & safety

- **Idempotent.** `populate_movie_sentence_bank` skips any movie that already has a `sentence_bank` row (`skip_if_exists=True`). Killing the worker mid-run and restarting it just resumes.
- **Per-movie atomicity.** Each movie's writes happen in the same transactional batch. A crash mid-movie leaves it half-populated; on resume, that movie is skipped (because *some* `sentence_bank` row exists) — partial data persists. Acceptable for a first pass; can be cleaned up later by re-running a force pass.
- **No LLM.** The backfill never calls OpenAI/Anthropic/translation services. Cost is CPU + DB writes only.
- **Rate of DB writes.** Each movie creates ~hundreds of `sentence_bank` rows + ~thousands of `sentence_lemma_links`. With Postgres on the same machine this is fine (~milliseconds per write); on a remote DB, expect roughly 2× the per-movie wall time.

---

## Monitoring while it runs

```bash
tail -f /tmp/sb-backfill.log

# Quick progress check (run anytime in another shell)
psql "$DATABASE_URL" -c "
  SELECT
    (SELECT COUNT(DISTINCT movie_id) FROM sentence_bank) AS banked,
    2848 - (SELECT COUNT(DISTINCT movie_id) FROM sentence_bank) AS remaining;
"
```

Each line in the log looks like:

```
[523/2748] movie=1234 ok in 2841ms — lemmas=945 with_sentences=860 sentences=412 links=1180
```

`with_sentences / lemmas` is your coverage — should be ~90% on most movies.

---

## Re-indexing the 5 legacy movies

Hoppers, Spirited Away, Schindler's List, Constantine, Project Hail Mary already have data, but it was written by the old literal-match indexer and has NULL `matched_form` on most rows. They'd benefit from re-indexing with the new code.

Two ways:

1. **Add `--force` to the script** (~10 lines): if set, deletes the movie's `sentence_bank` rows first (cascades to links via FK) before re-running. Then `python3.11 backfill_sentence_bank.py --force --movie 1 --movie 9 --movie 48 --movie 164 --movie 757`.

2. **Manual SQL + plain backfill**:
   ```sql
   DELETE FROM sentence_bank WHERE movie_id IN (1, 9, 48, 164, 757);
   ```
   Then `python3.11 backfill_sentence_bank.py --movie 1` (etc.).

Either way, low blast radius — these are 5 movies you've been testing.

---

## Recommended path

If you want it running tonight without setting up infra:

```bash
cd /Users/tamerlanmustafa/Downloads/wordwise/backend
set -a && source .env && set +a
caffeinate -i python3.11 backfill_sentence_bank.py 2>&1 | tee /tmp/sb-backfill.log
```

`caffeinate -i` keeps the laptop awake while the script runs. Output goes to both the terminal (so you can watch) and `/tmp/sb-backfill.log` (so it's there in the morning). When the run finishes, `caffeinate` releases and your laptop sleeps normally.

For "fire and forget while away":

```bash
caffeinate -i nohup python3.11 backfill_sentence_bank.py > /tmp/sb-backfill.log 2>&1 &
echo $! > /tmp/sb-backfill.pid
```

---

## Open questions for you

- Is the backend deployed somewhere (Railway/Render/VPS)? If yes, **Option D** is the right answer and I can wire it up.
- Do you want me to add `--force`, `--start-id`, `--end-id` flags now so the parallel and re-index plays are one command?
- Once the backfill is done, do we **delete the slow-path fallback** in the batch endpoint (it's vestigial after full coverage), or keep it as a permanent safety net?
