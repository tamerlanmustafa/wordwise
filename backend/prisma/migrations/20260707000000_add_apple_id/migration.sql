-- AlterTable
ALTER TABLE "users" ADD COLUMN     "apple_id" VARCHAR;

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_apple_id" ON "users"("apple_id");

