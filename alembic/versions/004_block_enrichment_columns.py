"""Add context_header, content_hash and chunk_idx to document_blocks.

context_header: LLM-generated 1-2 sentence header prepended at embed
    time so the vector captures doc-level entity context.
content_hash:   SHA-256 of block text; enables incremental re-ingest
    by skipping unchanged chunks.
chunk_idx:      Stable positional index within a document; used as the
    UPSERT key together with document_id.

Revision ID: 004_block_enrichment_columns
Revises: 003_platform_admin_flag
"""
from typing import Sequence, Union

from alembic import op


revision: str = "004_block_enrichment_columns"
down_revision: Union[str, None] = "003_platform_admin_flag"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE document_blocks ADD COLUMN IF NOT EXISTS context_header TEXT")
    op.execute("ALTER TABLE document_blocks ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)")
    op.execute("ALTER TABLE document_blocks ADD COLUMN IF NOT EXISTS chunk_idx INTEGER")
    op.execute("CREATE INDEX IF NOT EXISTS idx_document_blocks_content_hash ON document_blocks (content_hash)")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_document_blocks_doc_chunk "
        "ON document_blocks (document_id, chunk_idx) WHERE chunk_idx IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_document_blocks_doc_chunk")
    op.execute("DROP INDEX IF EXISTS idx_document_blocks_content_hash")
    op.execute("ALTER TABLE document_blocks DROP COLUMN IF EXISTS chunk_idx")
    op.execute("ALTER TABLE document_blocks DROP COLUMN IF EXISTS content_hash")
    op.execute("ALTER TABLE document_blocks DROP COLUMN IF EXISTS context_header")
