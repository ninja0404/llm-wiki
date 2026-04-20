"""Add users.is_platform_admin.

Revision ID: 003_platform_admin_flag
Revises: 002_platform_admin
"""
from typing import Sequence, Union

from alembic import op


revision: str = "003_platform_admin_flag"
down_revision: Union[str, None] = "001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS is_platform_admin")
