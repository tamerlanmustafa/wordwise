"""
Adaptive background worker for movie pre-processing.

Pulls movies from a Postgres-backed job queue, fetches their scripts,
classifies them with the existing CEFR pipeline, and stores results.
Rate is governed by a shared AIMD controller so the pool self-tunes
to whatever the upstream APIs (TMDB, STANDS4, OpenSubtitles) tolerate.
"""
