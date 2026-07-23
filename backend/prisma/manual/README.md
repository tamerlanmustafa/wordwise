# Manual SQL migrations

`prisma migrate` is **not** the migration path for this repo. The migration
history has pre-existing drift (family-plan changes and `src/workers/schema.sql`
were applied outside Prisma), so `migrate dev` and `db push` both demand a
destructive reset. Schema changes ship as hand-written SQL here instead.

## Rules

1. `prisma/schema.prisma` is the source of truth for anything Prisma can
   express. Every file here has a matching schema edit in the same commit.
2. Write files to be **idempotent** (`IF NOT EXISTS`, `IF EXISTS`, guarded
   `UPDATE`s) — they get replayed.
3. **Apply to prod before the code lands.** The regenerated Prisma client
   selects every column in the schema, so pushing code first breaks the read
   path for any column the DB doesn't have yet.
   ```
   railway connect Postgres        # or: psql "$DATABASE_PUBLIC_URL"
   \i backend/prisma/manual/<file>.sql
   ```
4. Don't wrap a file in `BEGIN`/`COMMIT` if it contains
   `ALTER TYPE ... ADD VALUE` — the new label isn't usable by later statements
   in the same transaction.

## Bootstrapping a fresh database

`schema.prisma` alone does **not** reproduce prod. Prisma cannot express
partial unique indexes, and there are two of them carrying real invariants:

| Index | Table | Purpose |
|---|---|---|
| `sentence_bank_hash_global_unique` | `sentence_bank` | dedup of global (`movie_id IS NULL`) LLM sentences |
| `user_words_global_word_unique` | `user_words` | dedup of global (`movie_id IS NULL`) learned markers |

So a fresh environment is: apply the schema, then replay **both**
`prisma/migrations_manual/*.sql` and `prisma/manual/*.sql` in filename order
(they are date-prefixed). `src/workers/schema.sql` is a third source — the
worker tables live only there.

Skipping the replay yields a database that passes `prisma validate` and
silently permits duplicates prod rejects.
