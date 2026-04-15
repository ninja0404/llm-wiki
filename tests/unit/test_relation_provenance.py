"""Test relation provenance merge/cleanup logic.

Validates the multi-source provenance contract:
  - Source A creates a relation → provenance = [A]
  - Source B finds the same relation → provenance = [A, B]
  - Re-ingest of Source A removes A from provenance → provenance = [B], relation preserved
  - Re-ingest of Source B removes B from provenance → provenance = [], relation deleted
"""

import orjson


def _merge_provenance(existing_meta: dict, new_doc_id: str) -> dict:
    """Simulates the merge logic from runner.py's relation INSERT path."""
    meta = dict(existing_meta)
    src_ids = meta.get("source_document_ids", [])
    if new_doc_id not in src_ids:
        src_ids.append(new_doc_id)
    meta["source_document_ids"] = src_ids
    return meta


def _cleanup_provenance(meta: dict, doc_id_to_remove: str) -> tuple[dict | None, bool]:
    """Simulates the cleanup logic from runner.py's re-ingest path.

    Returns (updated_meta, should_delete).
    """
    src_ids = meta.get("source_document_ids", [])
    remaining = [sid for sid in src_ids if sid != doc_id_to_remove]
    if remaining:
        return {**meta, "source_document_ids": remaining}, False
    return None, True


def test_initial_creation():
    meta = {"source": "compiler", "source_document_ids": ["doc-A"]}
    assert meta["source_document_ids"] == ["doc-A"]


def test_merge_second_source():
    meta = {"source": "compiler", "source_document_ids": ["doc-A"]}
    merged = _merge_provenance(meta, "doc-B")
    assert merged["source_document_ids"] == ["doc-A", "doc-B"]


def test_merge_duplicate_source_no_duplication():
    meta = {"source": "compiler", "source_document_ids": ["doc-A", "doc-B"]}
    merged = _merge_provenance(meta, "doc-A")
    assert merged["source_document_ids"] == ["doc-A", "doc-B"]


def test_cleanup_removes_one_source_preserves_relation():
    meta = {"source": "compiler", "source_document_ids": ["doc-A", "doc-B"]}
    updated, should_delete = _cleanup_provenance(meta, "doc-A")
    assert not should_delete
    assert updated["source_document_ids"] == ["doc-B"]


def test_cleanup_removes_last_source_deletes_relation():
    meta = {"source": "compiler", "source_document_ids": ["doc-A"]}
    updated, should_delete = _cleanup_provenance(meta, "doc-A")
    assert should_delete
    assert updated is None


def test_full_lifecycle():
    meta = {"source": "compiler", "source_document_ids": ["doc-A"]}

    meta = _merge_provenance(meta, "doc-B")
    assert meta["source_document_ids"] == ["doc-A", "doc-B"]

    meta, delete = _cleanup_provenance(meta, "doc-A")
    assert not delete
    assert meta["source_document_ids"] == ["doc-B"]

    _, delete = _cleanup_provenance(meta, "doc-B")
    assert delete


def test_provenance_serializable():
    meta = {"source": "compiler", "source_document_ids": ["doc-A", "doc-B"]}
    serialized = orjson.dumps(meta).decode()
    deserialized = orjson.loads(serialized)
    assert deserialized["source_document_ids"] == ["doc-A", "doc-B"]
