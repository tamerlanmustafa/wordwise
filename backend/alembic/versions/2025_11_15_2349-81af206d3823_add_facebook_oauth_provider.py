"""add_facebook_oauth_provider

Revision ID: 81af206d3823
Revises: 2025_11_15_oauth
Create Date: 2025-11-15 23:49:43.440771

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '81af206d3823'
down_revision = '2025_11_15_oauth'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add 'facebook' to the oauthprovider ENUM type."""
    # Add new value to existing ENUM type
    # IF NOT EXISTS requires PostgreSQL 9.1+
    op.execute("ALTER TYPE oauthprovider ADD VALUE IF NOT EXISTS 'facebook'")


def downgrade() -> None:
    """
    PostgreSQL does not support removing ENUM values directly.
    To remove a value, you must:
    1. Create a new ENUM type without the value
    2. Alter the column to use the new type
    3. Drop the old type

    For this reason, we leave downgrade empty as a safeguard.
    If you need to remove 'facebook', do it manually with caution.
    """
    pass


