"""
One-shot: pull popularity, vote_average, and vote_count from TMDB for every
`movies` row that has a tmdb_id but no popularity yet.

Idempotent — re-running only updates rows still missing data.
"""
import asyncio
import os
import asyncpg
import httpx

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "9dece7a38786ac0c58794d6db4af3d51")


async def main():
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://wordwise_user:wordwise_password@localhost:5432/wordwise_db",
    ).replace("postgres://", "postgresql://", 1)

    conn = await asyncpg.connect(db_url)
    rows = await conn.fetch(
        "SELECT id, tmdb_id FROM movies "
        "WHERE tmdb_id IS NOT NULL AND tmdb_popularity IS NULL "
        "ORDER BY id"
    )
    print(f"Backfilling {len(rows)} movies")

    ok = 0
    err = 0
    async with httpx.AsyncClient() as client:
        for r in rows:
            mid, tmdb_id = r["id"], r["tmdb_id"]
            try:
                resp = await client.get(
                    f"https://api.themoviedb.org/3/movie/{tmdb_id}",
                    params={"api_key": TMDB_API_KEY, "language": "en-US"},
                    timeout=15.0,
                )
                resp.raise_for_status()
                d = resp.json()
                await conn.execute(
                    "UPDATE movies SET tmdb_popularity = $1, "
                    "tmdb_vote_average = $2, tmdb_vote_count = $3 WHERE id = $4",
                    d.get("popularity"),
                    d.get("vote_average"),
                    d.get("vote_count"),
                    mid,
                )
                ok += 1
                if ok % 25 == 0:
                    print(f"  …{ok}/{len(rows)}")
            except Exception as e:
                err += 1
                print(f"  ! #{mid} tmdb={tmdb_id}: {e}")
            await asyncio.sleep(0.04)

    await conn.close()
    print(f"Done. ok={ok} err={err}")


if __name__ == "__main__":
    asyncio.run(main())
