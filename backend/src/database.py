"""
Database connection using Prisma Client Python.
Replaces SQLAlchemy session management.
"""

from prisma import Prisma

# Global Prisma client instance
prisma = Prisma()


async def connect_db():
    """Connect to database on startup"""
    if not prisma.is_connected():
        await prisma.connect()
    print("✅ Connected to database via Prisma")


async def disconnect_db():
    """Disconnect from database on shutdown"""
    if prisma.is_connected():
        await prisma.disconnect()
    print("❌ Disconnected from database")


async def get_db() -> Prisma:
    """
    Dependency injection for database client.
    Replaces SQLAlchemy's get_db() session.

    Usage:
        @app.get("/users")
        async def get_users(db: Prisma = Depends(get_db)):
            users = await db.user.find_many()
            return users
    """
    return prisma
