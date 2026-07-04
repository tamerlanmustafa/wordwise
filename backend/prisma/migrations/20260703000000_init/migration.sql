-- CreateEnum
CREATE TYPE "difficultylevel" AS ENUM ('BEGINNER', 'ELEMENTARY', 'INTERMEDIATE', 'UPPER_INTERMEDIATE', 'ADVANCED', 'PROFICIENT');

-- CreateEnum
CREATE TYPE "listtype" AS ENUM ('LEARN_LATER', 'FAVORITES', 'MASTERED');

-- CreateEnum
CREATE TYPE "booksourcetype" AS ENUM ('GUTENBERG', 'MANUAL_UPLOAD', 'OPEN_LIBRARY');

-- CreateEnum
CREATE TYPE "oauthprovider" AS ENUM ('email', 'google', 'facebook');

-- CreateEnum
CREATE TYPE "proficiencylevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- CreateEnum
CREATE TYPE "scriptsource" AS ENUM ('STANDS4_PDF', 'STANDS4_API', 'SUBTITLE_SRT', 'SUBTITLE_VTT', 'SYNOPSIS', 'MANUAL_UPLOAD');

-- CreateEnum
CREATE TYPE "classificationsource" AS ENUM ('oxford_3000', 'oxford_5000', 'efllex', 'evp', 'frequency_backoff', 'embedding_classifier', 'fallback');

-- CreateEnum
CREATE TYPE "sentencesource" AS ENUM ('subtitle', 'llm', 'tatoeba', 'public_domain');

-- CreateEnum
CREATE TYPE "interactiontype" AS ENUM ('ROW_CLICK', 'TRANSLATION_VIEW', 'DEFINITION_VIEW', 'WORD_SAVE', 'WORD_UNSAVE');

-- CreateEnum
CREATE TYPE "reportreason" AS ENUM ('WRONG_TRANSLATION', 'WRONG_CONTEXT', 'WRONG_SPELLING', 'INAPPROPRIATE_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "reportstatus" AS ENUM ('PENDING', 'REVIEWED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "subscriptiontier" AS ENUM ('free', 'trial', 'premium', 'comped');

-- CreateEnum
CREATE TYPE "moviestudystatus" AS ENUM ('unstudied', 'studied', 'mastered');

-- CreateEnum
CREATE TYPE "freezeacquisition" AS ENUM ('auto_weekly', 'iap', 'debug_grant', 'repair_grant');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR NOT NULL,
    "username" VARCHAR NOT NULL,
    "password_hash" VARCHAR,
    "language_preference" VARCHAR,
    "native_language" VARCHAR(10) DEFAULT 'en',
    "learning_language" VARCHAR(10) DEFAULT 'en',
    "proficiency_level" "proficiencylevel",
    "default_tab" VARCHAR(10) DEFAULT 'movies',
    "is_active" BOOLEAN,
    "is_admin" BOOLEAN,
    "subscription_tier" "subscriptiontier" DEFAULT 'free',
    "subscription_expires_at" TIMESTAMPTZ(6),
    "ads_eligible" BOOLEAN DEFAULT true,
    "srs_free_previews_used" INTEGER DEFAULT 0,
    "srs_current_streak" INTEGER DEFAULT 0,
    "srs_longest_streak" INTEGER DEFAULT 0,
    "srs_last_session_date" DATE,
    "srs_last_session_started_at" TIMESTAMPTZ(6),
    "srs_last_session_kind" VARCHAR(40),
    "srs_last_chest_date" DATE,
    "unlocked_cosmetics" JSONB DEFAULT '[]',
    "srs_total_reviews" INTEGER DEFAULT 0,
    "srs_total_correct" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "oauth_provider" "oauthprovider" NOT NULL,
    "google_id" VARCHAR,
    "profile_picture_url" VARCHAR,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movies" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR NOT NULL,
    "actual_title" VARCHAR,
    "year" INTEGER NOT NULL,
    "genre" VARCHAR,
    "difficulty_level" "difficultylevel",
    "difficulty_score" INTEGER,
    "cefr_distribution" JSONB,
    "script_text" TEXT,
    "word_count" INTEGER,
    "description" TEXT,
    "poster_url" VARCHAR,
    "tmdb_id" INTEGER,
    "tmdb_popularity" DOUBLE PRECISION,
    "tmdb_vote_average" DOUBLE PRECISION,
    "tmdb_vote_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "movies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR NOT NULL,
    "author" VARCHAR,
    "year" INTEGER,
    "description" TEXT,
    "cover_url" VARCHAR,
    "gutenberg_id" INTEGER,
    "open_library_key" VARCHAR,
    "isbn" VARCHAR,
    "difficulty_level" "difficultylevel",
    "difficulty_score" INTEGER,
    "cefr_distribution" JSONB,
    "word_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_texts" (
    "id" SERIAL NOT NULL,
    "book_id" INTEGER NOT NULL,
    "source_type" "booksourcetype" NOT NULL,
    "raw_text" TEXT,
    "cleaned_text" TEXT,
    "cleaned_word_count" INTEGER,
    "processing_metadata" JSONB,
    "epub_content" BYTEA,
    "total_pages" INTEGER,
    "page_extraction_method" VARCHAR(50),
    "page_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "book_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_word_classifications" (
    "id" SERIAL NOT NULL,
    "book_text_id" INTEGER NOT NULL,
    "word" VARCHAR NOT NULL,
    "lemma" VARCHAR NOT NULL,
    "pos" VARCHAR,
    "cefr_level" "proficiencylevel" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" "classificationsource" NOT NULL,
    "frequency_rank" INTEGER,
    "page_number" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_word_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movie_scripts" (
    "id" SERIAL NOT NULL,
    "movie_id" INTEGER NOT NULL,
    "source_used" "scriptsource" NOT NULL,
    "raw_subtitle_text" TEXT,
    "cleaned_script_text" TEXT,
    "cleaned_word_count" INTEGER,
    "tokenized_words" JSONB,
    "cefr_results" JSONB,
    "is_preprocessed" BOOLEAN NOT NULL DEFAULT false,
    "is_truncated" BOOLEAN NOT NULL DEFAULT false,
    "is_complete" BOOLEAN NOT NULL DEFAULT true,
    "processing_metadata" TEXT,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "movie_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_classifications" (
    "id" SERIAL NOT NULL,
    "script_id" INTEGER NOT NULL,
    "word" VARCHAR NOT NULL,
    "lemma" VARCHAR NOT NULL,
    "pos" VARCHAR,
    "cefr_level" "proficiencylevel" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" "classificationsource" NOT NULL,
    "frequency_rank" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "words" (
    "id" SERIAL NOT NULL,
    "word" VARCHAR NOT NULL,
    "definition" TEXT,
    "difficulty_level" "difficultylevel",
    "frequency" DOUBLE PRECISION,
    "part_of_speech" VARCHAR,
    "example_sentence" TEXT,
    "translation" VARCHAR,
    "movie_id" INTEGER,

    CONSTRAINT "words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_word_lists" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "word_id" INTEGER NOT NULL,
    "list_type" "listtype" NOT NULL,
    "added_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_word_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alembic_version" (
    "version_num" VARCHAR(32) NOT NULL,

    CONSTRAINT "alembic_version_pkc" PRIMARY KEY ("version_num")
);

-- CreateTable
CREATE TABLE "script_source_priorities" (
    "id" SERIAL NOT NULL,
    "source" "scriptsource" NOT NULL,
    "priority" INTEGER NOT NULL,

    CONSTRAINT "script_source_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movie_aliases" (
    "id" SERIAL NOT NULL,
    "movie_id" INTEGER NOT NULL,
    "alias" VARCHAR NOT NULL,

    CONSTRAINT "movie_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_cache" (
    "id" SERIAL NOT NULL,
    "source_text" VARCHAR NOT NULL,
    "source_lang" VARCHAR(10),
    "target_lang" VARCHAR(10) NOT NULL,
    "translated" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "translation_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_translation_history" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "word" VARCHAR NOT NULL,
    "target_lang" VARCHAR(10) NOT NULL,
    "translation_used" VARCHAR NOT NULL,
    "provider" VARCHAR(20),
    "translated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_translation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_words" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "word" VARCHAR NOT NULL,
    "movie_id" INTEGER,
    "is_learned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "srs_box" INTEGER NOT NULL DEFAULT 1,
    "srs_due_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "srs_last_reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_word_interactions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "word" VARCHAR NOT NULL,
    "movie_id" INTEGER,
    "interaction_type" "interactiontype" NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_word_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_sentence_examples" (
    "id" SERIAL NOT NULL,
    "movie_id" INTEGER NOT NULL,
    "word" VARCHAR NOT NULL,
    "lemma" VARCHAR NOT NULL,
    "cefr_level" "proficiencylevel" NOT NULL,
    "sentence" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "target_lang" VARCHAR(10) NOT NULL,
    "word_position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "word_sentence_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lemmas" (
    "id" SERIAL NOT NULL,
    "lemma" VARCHAR NOT NULL,
    "pos" VARCHAR(10),
    "cefr_level" "proficiencylevel" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" "classificationsource" NOT NULL DEFAULT 'fallback',
    "frequency_rank" INTEGER,
    "word_forms" JSONB,
    "is_multi_word" BOOLEAN NOT NULL DEFAULT false,
    "priority_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_movie_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lemmas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_senses" (
    "id" SERIAL NOT NULL,
    "lemma_id" INTEGER NOT NULL,
    "sense_index" INTEGER NOT NULL,
    "pos" VARCHAR(10),
    "label" VARCHAR(200),
    "representative_sentence" TEXT,
    "keywords" JSONB,
    "cluster_centroid" JSONB,
    "sentence_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "word_senses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_memory" (
    "id" SERIAL NOT NULL,
    "lemma_id" INTEGER NOT NULL,
    "sense_id" INTEGER NOT NULL,
    "target_lang" VARCHAR(10) NOT NULL,
    "translated_word" VARCHAR NOT NULL,
    "translated_sentence" TEXT,
    "word_provider" VARCHAR(20) NOT NULL,
    "sentence_provider" VARCHAR(20),
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "report_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "translation_memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movie_lemma_mappings" (
    "id" SERIAL NOT NULL,
    "movie_id" INTEGER NOT NULL,
    "lemma_id" INTEGER NOT NULL,
    "frequency_in_movie" INTEGER NOT NULL DEFAULT 1,
    "dominant_sense_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movie_lemma_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentence_bank" (
    "id" SERIAL NOT NULL,
    "sentence_hash" VARCHAR(64) NOT NULL,
    "sentence" TEXT NOT NULL,
    "movie_id" INTEGER,
    "source" "sentencesource" NOT NULL DEFAULT 'subtitle',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentence_bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage_ledger" (
    "id" SERIAL NOT NULL,
    "ts" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" VARCHAR(64) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_creation_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "context" VARCHAR(64) NOT NULL DEFAULT 'unknown',

    CONSTRAINT "llm_usage_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentence_lemma_links" (
    "id" SERIAL NOT NULL,
    "sentence_id" INTEGER NOT NULL,
    "lemma_id" INTEGER NOT NULL,
    "sense_id" INTEGER,
    "word_position" INTEGER,
    "matched_form" VARCHAR,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_representative" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sentence_lemma_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hidden_words" (
    "id" SERIAL NOT NULL,
    "word" VARCHAR NOT NULL,
    "hidden_by_id" INTEGER NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hidden_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_reports" (
    "id" SERIAL NOT NULL,
    "word" VARCHAR NOT NULL,
    "movie_id" INTEGER,
    "movie_title" VARCHAR,
    "reason" "reportreason" NOT NULL,
    "details" TEXT,
    "translation_source" VARCHAR,
    "status" "reportstatus" NOT NULL DEFAULT 'PENDING',
    "reporter_id" INTEGER NOT NULL,
    "reviewer_id" INTEGER,
    "review_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "word_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_sessions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "movie_id" INTEGER,
    "cefr_level" VARCHAR(2) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "stars" INTEGER,
    "correct_count" INTEGER NOT NULL DEFAULT 0,
    "total_scored" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quiz_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_card_results" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "word" VARCHAR NOT NULL,
    "card_type" VARCHAR(16) NOT NULL,
    "is_correct" BOOLEAN,
    "self_rating" VARCHAR(8),
    "answer_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_card_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_quiz_stats" (
    "user_id" INTEGER NOT NULL,
    "total_stars" INTEGER NOT NULL DEFAULT 0,
    "total_sessions" INTEGER NOT NULL DEFAULT 0,
    "avg_accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retention_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_quiz_stats_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "unit_progress" (
    "user_id" INTEGER NOT NULL,
    "movie_id" INTEGER NOT NULL,
    "cefr_level" VARCHAR(2) NOT NULL,
    "best_stars" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "unit_progress_pkey" PRIMARY KEY ("user_id","movie_id","cefr_level")
);

-- CreateTable
CREATE TABLE "user_reel_movies" (
    "user_id" INTEGER NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR NOT NULL,
    "poster_path" VARCHAR,
    "year" INTEGER,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_reel_movies_pkey" PRIMARY KEY ("user_id","tmdb_id")
);

-- CreateTable
CREATE TABLE "user_movie_progress" (
    "user_id" INTEGER NOT NULL,
    "movie_id" INTEGER NOT NULL,
    "lemmas_touched" INTEGER NOT NULL DEFAULT 0,
    "lemmas_in_box_2_plus" INTEGER NOT NULL DEFAULT 0,
    "lemmas_mastered" INTEGER NOT NULL DEFAULT 0,
    "comprehensibility_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "moviestudystatus" NOT NULL DEFAULT 'unstudied',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_movie_progress_pkey" PRIMARY KEY ("user_id","movie_id")
);

-- CreateTable
CREATE TABLE "user_streak_freezes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "acquired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acquired_via" "freezeacquisition" NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "consumed_reason" VARCHAR,

    CONSTRAINT "user_streak_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" SERIAL NOT NULL,
    "flag_key" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rollout_pct" INTEGER NOT NULL DEFAULT 100,
    "variants" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_feature_flags" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "flag_key" VARCHAR(100) NOT NULL,
    "variant" VARCHAR(50),
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "key" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(20),
    "category" VARCHAR(30) NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "achievement_key" VARCHAR(50) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "unlocked" BOOLEAN NOT NULL DEFAULT false,
    "unlocked_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_plans" (
    "id" SERIAL NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "max_members" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_verifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "email" VARCHAR(255),
    "method" VARCHAR(20) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "student_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_email" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_username" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_google_id" ON "users"("google_id");

-- CreateIndex
CREATE INDEX "ix_users_id" ON "users"("id");

-- CreateIndex
CREATE UNIQUE INDEX "movies_tmdb_id_key" ON "movies"("tmdb_id");

-- CreateIndex
CREATE INDEX "ix_movies_id" ON "movies"("id");

-- CreateIndex
CREATE INDEX "ix_movies_title" ON "movies"("title");

-- CreateIndex
CREATE INDEX "ix_movies_difficulty" ON "movies"("difficulty_level");

-- CreateIndex
CREATE UNIQUE INDEX "books_gutenberg_id_key" ON "books"("gutenberg_id");

-- CreateIndex
CREATE INDEX "ix_books_id" ON "books"("id");

-- CreateIndex
CREATE INDEX "ix_books_title" ON "books"("title");

-- CreateIndex
CREATE INDEX "ix_books_gutenberg_id" ON "books"("gutenberg_id");

-- CreateIndex
CREATE INDEX "ix_books_difficulty" ON "books"("difficulty_level");

-- CreateIndex
CREATE UNIQUE INDEX "book_texts_book_id_key" ON "book_texts"("book_id");

-- CreateIndex
CREATE INDEX "ix_book_texts_book_id" ON "book_texts"("book_id");

-- CreateIndex
CREATE INDEX "ix_book_word_classifications_book_text_id" ON "book_word_classifications"("book_text_id");

-- CreateIndex
CREATE INDEX "ix_book_word_classifications_lemma" ON "book_word_classifications"("lemma");

-- CreateIndex
CREATE INDEX "ix_book_word_classifications_cefr_level" ON "book_word_classifications"("cefr_level");

-- CreateIndex
CREATE INDEX "ix_book_word_classifications_book_cefr" ON "book_word_classifications"("book_text_id", "cefr_level");

-- CreateIndex
CREATE INDEX "ix_book_word_classifications_page" ON "book_word_classifications"("page_number");

-- CreateIndex
CREATE INDEX "ix_movie_scripts_movie_id" ON "movie_scripts"("movie_id");

-- CreateIndex
CREATE INDEX "ix_movie_scripts_source" ON "movie_scripts"("source_used");

-- CreateIndex
CREATE UNIQUE INDEX "movie_scripts_movie_id_key" ON "movie_scripts"("movie_id");

-- CreateIndex
CREATE INDEX "ix_word_classifications_script_id" ON "word_classifications"("script_id");

-- CreateIndex
CREATE INDEX "ix_word_classifications_lemma" ON "word_classifications"("lemma");

-- CreateIndex
CREATE INDEX "ix_word_classifications_cefr_level" ON "word_classifications"("cefr_level");

-- CreateIndex
CREATE INDEX "ix_word_classifications_script_cefr" ON "word_classifications"("script_id", "cefr_level");

-- CreateIndex
CREATE INDEX "ix_words_id" ON "words"("id");

-- CreateIndex
CREATE INDEX "ix_words_word" ON "words"("word");

-- CreateIndex
CREATE INDEX "ix_user_word_lists_id" ON "user_word_lists"("id");

-- CreateIndex
CREATE UNIQUE INDEX "script_source_priorities_source_key" ON "script_source_priorities"("source");

-- CreateIndex
CREATE INDEX "ix_script_source_priority_priority" ON "script_source_priorities"("priority");

-- CreateIndex
CREATE INDEX "ix_movie_aliases_movie_id" ON "movie_aliases"("movie_id");

-- CreateIndex
CREATE INDEX "ix_movie_aliases_alias" ON "movie_aliases"("alias");

-- CreateIndex
CREATE INDEX "ix_translation_cache_source_text" ON "translation_cache"("source_text");

-- CreateIndex
CREATE INDEX "ix_translation_cache_target_lang" ON "translation_cache"("target_lang");

-- CreateIndex
CREATE UNIQUE INDEX "unique_translation" ON "translation_cache"("source_text", "target_lang");

-- CreateIndex
CREATE INDEX "ix_user_translation_history_user_id" ON "user_translation_history"("user_id");

-- CreateIndex
CREATE INDEX "ix_user_translation_history_user_word" ON "user_translation_history"("user_id", "word");

-- CreateIndex
CREATE INDEX "ix_user_translation_history_user_date" ON "user_translation_history"("user_id", "translated_at");

-- CreateIndex
CREATE INDEX "ix_user_words_user_id" ON "user_words"("user_id");

-- CreateIndex
CREATE INDEX "ix_user_words_user_learned" ON "user_words"("user_id", "is_learned");

-- CreateIndex
CREATE INDEX "ix_user_words_user_due" ON "user_words"("user_id", "srs_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "unique_user_word_movie" ON "user_words"("user_id", "word", "movie_id");

-- CreateIndex
CREATE INDEX "ix_user_word_interactions_user_word" ON "user_word_interactions"("user_id", "word");

-- CreateIndex
CREATE INDEX "ix_user_word_interactions_user_date" ON "user_word_interactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_user_word_interactions_word" ON "user_word_interactions"("word");

-- CreateIndex
CREATE INDEX "ix_word_sentence_examples_movie_id" ON "word_sentence_examples"("movie_id");

-- CreateIndex
CREATE INDEX "ix_word_sentence_examples_movie_word" ON "word_sentence_examples"("movie_id", "word");

-- CreateIndex
CREATE INDEX "ix_word_sentence_examples_movie_lang" ON "word_sentence_examples"("movie_id", "target_lang");

-- CreateIndex
CREATE UNIQUE INDEX "unique_word_sentence_example" ON "word_sentence_examples"("movie_id", "word", "sentence", "target_lang");

-- CreateIndex
CREATE UNIQUE INDEX "lemmas_lemma_key" ON "lemmas"("lemma");

-- CreateIndex
CREATE INDEX "ix_lemmas_cefr_level" ON "lemmas"("cefr_level");

-- CreateIndex
CREATE INDEX "ix_lemmas_frequency_rank" ON "lemmas"("frequency_rank");

-- CreateIndex
CREATE INDEX "ix_lemmas_priority_score" ON "lemmas"("priority_score");

-- CreateIndex
CREATE INDEX "ix_word_senses_lemma_id" ON "word_senses"("lemma_id");

-- CreateIndex
CREATE INDEX "ix_word_senses_lemma_pos" ON "word_senses"("lemma_id", "pos");

-- CreateIndex
CREATE UNIQUE INDEX "unique_lemma_sense" ON "word_senses"("lemma_id", "sense_index");

-- CreateIndex
CREATE INDEX "ix_translation_memory_lemma_lang" ON "translation_memory"("lemma_id", "target_lang");

-- CreateIndex
CREATE INDEX "ix_translation_memory_target_lang" ON "translation_memory"("target_lang");

-- CreateIndex
CREATE UNIQUE INDEX "unique_translation_memory" ON "translation_memory"("lemma_id", "sense_id", "target_lang");

-- CreateIndex
CREATE INDEX "ix_movie_lemma_mapping_movie_id" ON "movie_lemma_mappings"("movie_id");

-- CreateIndex
CREATE INDEX "ix_movie_lemma_mapping_lemma_id" ON "movie_lemma_mappings"("lemma_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_movie_lemma" ON "movie_lemma_mappings"("movie_id", "lemma_id");

-- CreateIndex
CREATE INDEX "ix_sentence_bank_movie_id" ON "sentence_bank"("movie_id");

-- CreateIndex
CREATE INDEX "ix_sentence_bank_sentence_hash" ON "sentence_bank"("sentence_hash");

-- CreateIndex
CREATE INDEX "ix_sentence_bank_movie_source" ON "sentence_bank"("movie_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "sentence_bank_hash_movie_unique" ON "sentence_bank"("sentence_hash", "movie_id");

-- CreateIndex
CREATE INDEX "ix_llm_usage_ledger_ts" ON "llm_usage_ledger"("ts");

-- CreateIndex
CREATE INDEX "ix_sentence_lemma_link_lemma_sense" ON "sentence_lemma_links"("lemma_id", "sense_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_sentence_lemma" ON "sentence_lemma_links"("sentence_id", "lemma_id");

-- CreateIndex
CREATE UNIQUE INDEX "hidden_words_word_key" ON "hidden_words"("word");

-- CreateIndex
CREATE INDEX "ix_hidden_words_word" ON "hidden_words"("word");

-- CreateIndex
CREATE INDEX "ix_word_reports_status" ON "word_reports"("status");

-- CreateIndex
CREATE INDEX "ix_word_reports_word" ON "word_reports"("word");

-- CreateIndex
CREATE INDEX "ix_word_reports_reporter" ON "word_reports"("reporter_id");

-- CreateIndex
CREATE INDEX "ix_quiz_sessions_user_movie_level" ON "quiz_sessions"("user_id", "movie_id", "cefr_level");

-- CreateIndex
CREATE INDEX "ix_quiz_sessions_completed_at" ON "quiz_sessions"("completed_at");

-- CreateIndex
CREATE INDEX "ix_quiz_card_results_session" ON "quiz_card_results"("session_id");

-- CreateIndex
CREATE INDEX "ix_quiz_card_results_word" ON "quiz_card_results"("word");

-- CreateIndex
CREATE INDEX "ix_user_quiz_stats_total_stars" ON "user_quiz_stats"("total_stars");

-- CreateIndex
CREATE INDEX "ix_user_quiz_stats_xp" ON "user_quiz_stats"("xp");

-- CreateIndex
CREATE INDEX "ix_user_quiz_stats_retention" ON "user_quiz_stats"("retention_score");

-- CreateIndex
CREATE INDEX "ix_unit_progress_user_movie" ON "unit_progress"("user_id", "movie_id");

-- CreateIndex
CREATE INDEX "ix_user_reel_movies_user_added_at" ON "user_reel_movies"("user_id", "added_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_user_reel_movies_user_position" ON "user_reel_movies"("user_id", "position");

-- CreateIndex
CREATE INDEX "ix_user_movie_progress_user" ON "user_movie_progress"("user_id");

-- CreateIndex
CREATE INDEX "ix_user_movie_progress_comprehensibility" ON "user_movie_progress"("user_id", "comprehensibility_percent" DESC);

-- CreateIndex
CREATE INDEX "ix_user_streak_freezes_held" ON "user_streak_freezes"("user_id", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_flag_key_key" ON "feature_flags"("flag_key");

-- CreateIndex
CREATE UNIQUE INDEX "user_feature_flags_user_id_flag_key_key" ON "user_feature_flags"("user_id", "flag_key");

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_user_id_achievement_key_key" ON "user_achievements"("user_id", "achievement_key");

-- CreateIndex
CREATE UNIQUE INDEX "family_plans_owner_id_key" ON "family_plans"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_members_plan_id_user_id_key" ON "family_members"("plan_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_verifications_user_id_method_key" ON "student_verifications"("user_id", "method");

-- AddForeignKey
ALTER TABLE "book_texts" ADD CONSTRAINT "book_texts_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_word_classifications" ADD CONSTRAINT "book_word_classifications_book_text_id_fkey" FOREIGN KEY ("book_text_id") REFERENCES "book_texts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_scripts" ADD CONSTRAINT "movie_scripts_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "word_classifications" ADD CONSTRAINT "word_classifications_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "movie_scripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "words" ADD CONSTRAINT "words_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_word_lists" ADD CONSTRAINT "user_word_lists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_word_lists" ADD CONSTRAINT "user_word_lists_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "words"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movie_aliases" ADD CONSTRAINT "movie_aliases_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_translation_history" ADD CONSTRAINT "user_translation_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_words" ADD CONSTRAINT "user_words_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_words" ADD CONSTRAINT "user_words_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_word_interactions" ADD CONSTRAINT "user_word_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_word_interactions" ADD CONSTRAINT "user_word_interactions_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_senses" ADD CONSTRAINT "word_senses_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "lemmas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_memory" ADD CONSTRAINT "translation_memory_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "lemmas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_memory" ADD CONSTRAINT "translation_memory_sense_id_fkey" FOREIGN KEY ("sense_id") REFERENCES "word_senses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_lemma_mappings" ADD CONSTRAINT "movie_lemma_mappings_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_lemma_mappings" ADD CONSTRAINT "movie_lemma_mappings_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "lemmas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_lemma_mappings" ADD CONSTRAINT "movie_lemma_mappings_dominant_sense_id_fkey" FOREIGN KEY ("dominant_sense_id") REFERENCES "word_senses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentence_bank" ADD CONSTRAINT "sentence_bank_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentence_lemma_links" ADD CONSTRAINT "sentence_lemma_links_sentence_id_fkey" FOREIGN KEY ("sentence_id") REFERENCES "sentence_bank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentence_lemma_links" ADD CONSTRAINT "sentence_lemma_links_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "lemmas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentence_lemma_links" ADD CONSTRAINT "sentence_lemma_links_sense_id_fkey" FOREIGN KEY ("sense_id") REFERENCES "word_senses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hidden_words" ADD CONSTRAINT "hidden_words_hidden_by_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_reports" ADD CONSTRAINT "word_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_reports" ADD CONSTRAINT "word_reports_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_reports" ADD CONSTRAINT "word_reports_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_sessions" ADD CONSTRAINT "quiz_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_card_results" ADD CONSTRAINT "quiz_card_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "quiz_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quiz_stats" ADD CONSTRAINT "user_quiz_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_progress" ADD CONSTRAINT "unit_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reel_movies" ADD CONSTRAINT "user_reel_movies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_movie_progress" ADD CONSTRAINT "user_movie_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_movie_progress" ADD CONSTRAINT "user_movie_progress_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_streak_freezes" ADD CONSTRAINT "user_streak_freezes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_feature_flags" ADD CONSTRAINT "user_feature_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_feature_flags" ADD CONSTRAINT "user_feature_flags_flag_key_fkey" FOREIGN KEY ("flag_key") REFERENCES "feature_flags"("flag_key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_key_fkey" FOREIGN KEY ("achievement_key") REFERENCES "achievements"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_plans" ADD CONSTRAINT "family_plans_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "family_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_verifications" ADD CONSTRAINT "student_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

