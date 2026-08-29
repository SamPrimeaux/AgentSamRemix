-- Service-owned copy: supabase/migrations/20260823120000_agentsam_memory_type_commit_align.sql
-- Apply via Supabase lane (Hyperdrive). Do not copy into D1 migrations/.

ALTER TABLE agentsam.agentsam_memory
  DROP CONSTRAINT IF EXISTS agentsam_memory_memory_type_check;

ALTER TABLE agentsam.agentsam_memory
  ADD CONSTRAINT agentsam_memory_memory_type_check
  CHECK (memory_type IN (
    'fact', 'preference', 'decision', 'policy', 'state', 'procedure', 'event', 'error',
    'project', 'skill'
  ));

COMMENT ON CONSTRAINT agentsam_memory_memory_type_check ON agentsam.agentsam_memory IS
  'Must match D1 agentsam_memory CHECK (947) and MANAGED_MEMORY_TYPES in agentsam-memory-contract.js';
