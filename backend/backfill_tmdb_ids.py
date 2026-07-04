"""
One-shot backfill: for every `movies` row missing `tmdb_id`, search TMDB by
(title, year), pick the best English match, and store the id.

Run from the backend directory:
    python backfill_tmdb_ids.py

Idempotent — re-running will only touch rows that are still missing an id.
"""
import asyncio
import os
import sys
import asyncpg
import httpx

TMDB_API_KEY = os.environ["TMDB_API_KEY"]  # required; no fallback — keep keys out of the repo
TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie"


def normalize(s: str) -> str:
    return "".join(c.lower() for c in s if c.isalnum())


async def find_tmdb_id(client: httpx.AsyncClient, title: str, year: int | None) -> int | None:
    params = {"api_key": TMDB_API_KEY, "query": title, "include_adult": "false"}
    if year:
        params["year"] = year
    try:
        r = await client.get(TMDB_SEARCH_URL, params=params, timeout=15.0)
        r.raise_for_status()
        results = (r.json() or {}).get("results") or []
    except Exception as e:
        print(f"  ! TMDB error: {e}")
        return None

    if not results:
        # Retry without year — some of our years are wrong (e.g. Pirates 2000).
        if year:
            params.pop("year")
            try:
                r = await client.get(TMDB_SEARCH_URL, params=params, timeout=15.0)
                r.raise_for_status()
                results = (r.json() or {}).get("results") or []
            except Exception as e:
                print(f"  ! TMDB retry error: {e}")
                return None
        if not results:
            return None

    target = normalize(title)
    # Prefer English originals + exact normalized-title match.
    for r in results:
        if (r.get("original_language") == "en"
                and normalize(r.get("title") or "") == target):
            return r.get("id")
    # Fall back to the most popular English match.
    english = [r for r in results if r.get("original_language") == "en"]
    if english:
        english.sort(key=lambda x: x.get("popularity", 0), reverse=True)
        return english[0].get("id")
    # Last resort: top result regardless of language.
    return results[0].get("id")


async def main():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        # Fall back to local default.
        db_url = "postgresql://wordwise_user:wordwise_pass@localhost:5432/wordwise_db"
    # asyncpg expects postgresql:// not postgres://
    db_url = db_url.replace("postgres://", "postgresql://", 1)

    conn = await asyncpg.connect(db_url)
    rows = await conn.fetch(
        "SELECT id, title, year FROM movies WHERE tmdb_id IS NULL ORDER BY id"
    )
    print(f"Found {len(rows)} movies missing tmdb_id")

    matched = 0
    skipped = 0
    async with httpx.AsyncClient() as client:
        for row in rows:
            mid, title, year = row["id"], row["title"], row["year"]
            print(f"#{mid}  {title} ({year})")
            tmdb_id = await find_tmdb_id(client, title, year)
            if tmdb_id is None:
                print("  → no match")
                skipped += 1
                continue
            try:
                await conn.execute(
                    "UPDATE movies SET tmdb_id = $1 WHERE id = $2",
                    tmdb_id, mid
                )
                print(f"  → tmdb_id = {tmdb_id}")
                matched += 1
            except asyncpg.UniqueViolationError:
                # Another movies row already owns this tmdb_id — skip rather
                # than overwrite. Manual cleanup later if needed.
                print(f"  ! tmdb_id {tmdb_id} already used by another row, skipping")
                skipped += 1
            # Be polite to TMDB (40 req / 10s soft cap).
            await asyncio.sleep(0.05)

    await conn.close()
    print(f"\nDone. matched={matched} skipped={skipped} total={len(rows)}")


if __name__ == "__main__":
    asyncio.run(main())
