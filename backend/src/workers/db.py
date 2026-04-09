"""
Asyncpg pool used by every worker process.

We deliberately do not share Prisma's connection here. The worker subsystem
needs raw SQL primitives that Prisma doesn't expose cleanly:
  - SELECT ... FOR UPDATE SKIP LOCKED inside an explicit transaction
  - prepared statements for the hot claim path
  - low per-call overhead for the token-bucket update
"""

from __future__ import annotations

import os
from typing import Optional

import asyncpg

_pool: Optional[asyncpg.Pool] = None


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    # asyncpg doesn't accept the prisma-style ?schema=public suffix
    if "?" in url:
        url = url.split("?", 1)[0]
    return url


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=_database_url(),
            min_size=1,
            max_size=int(os.environ.get("WORKER_PG_POOL_MAX", "4")),
            command_timeout=30,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
