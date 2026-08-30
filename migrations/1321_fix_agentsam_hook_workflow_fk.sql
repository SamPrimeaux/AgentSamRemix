-- Repoint agentsam_hook.workflow_id from retired agentsam_mcp_workflows
-- to canonical agentsam_workflows without rebuilding agentsam_hook.
--
-- Safety notes:
-- - Existing agentsam_hook.workflow_id population was verified as 0 rows before apply.
-- - We avoid dropping/recreating agentsam_hook because live tables reference it,
--   including agentsam_hook_execution ON DELETE CASCADE.
-- - This migration changes only the workflow_id column definition.

ALTER TABLE agentsam_hook
  ADD COLUMN workflow_id_v2 TEXT
  REFERENCES agentsam_workflows(id)
  ON DELETE SET NULL;

UPDATE agentsam_hook
SET workflow_id_v2 = workflow_id
WHERE workflow_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM agentsam_workflows w
    WHERE w.id = agentsam_hook.workflow_id
  );

ALTER TABLE agentsam_hook
  DROP COLUMN workflow_id;

ALTER TABLE agentsam_hook
  RENAME COLUMN workflow_id_v2 TO workflow_id;
