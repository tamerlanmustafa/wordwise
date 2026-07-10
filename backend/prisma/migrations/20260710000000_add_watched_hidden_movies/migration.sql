-- CreateTable
CREATE TABLE "user_watched_movies" (
    "user_id" INTEGER NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "title" VARCHAR NOT NULL,
    "poster_path" VARCHAR,
    "year" INTEGER,
    "watched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_watched_movies_pkey" PRIMARY KEY ("user_id","tmdb_id")
);

-- CreateTable
CREATE TABLE "user_hidden_movies" (
    "user_id" INTEGER NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "hidden_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_hidden_movies_pkey" PRIMARY KEY ("user_id","tmdb_id")
);

-- CreateIndex
CREATE INDEX "ix_user_watched_movies_user_watched_at" ON "user_watched_movies"("user_id", "watched_at");

-- CreateIndex
CREATE INDEX "ix_user_hidden_movies_user_hidden_at" ON "user_hidden_movies"("user_id", "hidden_at");

-- AddForeignKey
ALTER TABLE "user_watched_movies" ADD CONSTRAINT "user_watched_movies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_hidden_movies" ADD CONSTRAINT "user_hidden_movies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

