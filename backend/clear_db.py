"""
Clear all database tables except User table

WARNING: This will delete ALL data from:
- MovieScript
- WordClassification
- Movie
- Any other tables except User

Run this only if you want to start fresh!
"""

import asyncio
import sys
from src.database import prisma

async def clear_database():
    print("=" * 80)
    print("DATABASE CLEANUP - PRESERVE USER TABLE ONLY")
    print("=" * 80)
    print()

    # Get confirmation
    print("⚠️  WARNING: This will DELETE all data from:")
    print("   - MovieScript table")
    print("   - WordClassification table")
    print("   - Movie table")
    print("   - All other tables EXCEPT User table")
    print()

    confirm = input("Are you sure you want to proceed? Type 'YES' to continue: ")

    if confirm != "YES":
        print("❌ Aborted. No changes made.")
        return

    print()
    print("🔄 Connecting to database...")

    # Connect to database
    if not prisma.is_connected():
        await prisma.connect()

    db = prisma

    try:
        # Delete in correct order (respecting foreign key constraints)

        # 1. Delete WordClassifications first (depends on Movie)
        print("🗑️  Deleting WordClassifications...")
        deleted_words = await db.wordclassification.delete_many()
        print(f"   ✓ Deleted {deleted_words} word classifications")

        # 2. Delete MovieScripts (depends on Movie)
        print("🗑️  Deleting MovieScripts...")
        deleted_scripts = await db.moviescript.delete_many()
        print(f"   ✓ Deleted {deleted_scripts} movie scripts")

        # 3. Delete Movies
        print("🗑️  Deleting Movies...")
        deleted_movies = await db.movie.delete_many()
        print(f"   ✓ Deleted {deleted_movies} movies")

        print()
        print("=" * 80)
        print("✅ DATABASE CLEARED SUCCESSFULLY")
        print("=" * 80)
        print()
        print("📊 Summary:")
        print(f"   - {deleted_words} word classifications deleted")
        print(f"   - {deleted_scripts} movie scripts deleted")
        print(f"   - {deleted_movies} movies deleted")
        print(f"   - User table preserved ✓")
        print()

    except Exception as e:
        print()
        print("=" * 80)
        print("❌ ERROR DURING CLEANUP")
        print("=" * 80)
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

    finally:
        await db.disconnect()
        print("🔌 Disconnected from database")

if __name__ == "__main__":
    print()
    asyncio.run(clear_database())
    print()
