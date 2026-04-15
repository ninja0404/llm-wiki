CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_unique_pair
  ON relations (workspace_id, source_entity_id, target_entity_id, relation_type);
