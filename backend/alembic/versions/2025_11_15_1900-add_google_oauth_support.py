"""Add Google OAuth support to User model

Revision ID: 2025_11_15_oauth
Revises:
Create Date: 2025-11-15 19:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '2025_11_15_oauth'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add OAuth fields to users table"""

    # Create OAuthProvider enum type first (if it doesn't exist)
    op.execute("DO $$ BEGIN CREATE TYPE oauthprovider AS ENUM ('email', 'google'); EXCEPTION WHEN duplicate_object THEN null; END $$;")

    # Add OAuth provider column with default EMAIL
    # First add it as nullable
    op.add_column('users', sa.Column(
        'oauth_provider',
        postgresql.ENUM('email', 'google', name='oauthprovider', create_type=False),
        nullable=True
    ))

    # Set default value for existing rows
    op.execute("UPDATE users SET oauth_provider = 'email' WHERE oauth_provider IS NULL")

    # Now make it not nullable
    op.alter_column('users', 'oauth_provider', nullable=False)

    # Add Google ID column
    op.add_column('users', sa.Column(
        'google_id',
        sa.String(),
        nullable=True
    ))

    # Add profile picture URL column
    op.add_column('users', sa.Column(
        'profile_picture_url',
        sa.String(),
        nullable=True
    ))

    # Make password_hash nullable for OAuth users
    op.alter_column('users', 'password_hash',
                    existing_type=sa.String(),
                    nullable=True)

    # Create index on google_id for faster lookups
    op.create_index('ix_users_google_id', 'users', ['google_id'], unique=True)


def downgrade() -> None:
    """Remove OAuth fields from users table"""

    # Drop index
    op.drop_index('ix_users_google_id', table_name='users')

    # Drop columns
    op.drop_column('users', 'profile_picture_url')
    op.drop_column('users', 'google_id')
    op.drop_column('users', 'oauth_provider')

    # Make password_hash non-nullable again
    op.alter_column('users', 'password_hash',
                    existing_type=sa.String(),
                    nullable=False)

    # Drop enum type
    op.execute("DROP TYPE IF EXISTS oauthprovider")
