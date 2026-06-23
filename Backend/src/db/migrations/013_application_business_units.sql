-- Migration 013: application_business_units junction table
-- Replaces the single nullable FK `applications.target_bu_id` with a many-to-many
-- relationship so one app can target multiple Business Units.
-- Global apps = zero rows in this table (same semantics as target_bu_id IS NULL).
--
-- Strategy:
--   1. Create the junction table.
--   2. Backfill from the existing single-BU assignments.
--   3. Keep target_bu_id column in place temporarily — it stops being written to
--      once the application code is updated to use this table exclusively.
--      A later migration can DROP COLUMN target_bu_id when ready.

CREATE TABLE IF NOT EXISTS application_business_units (
  application_id   UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  business_unit_id UUID NOT NULL REFERENCES business_units(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, business_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_app_bu_application_id  ON application_business_units (application_id);
CREATE INDEX IF NOT EXISTS idx_app_bu_business_unit_id ON application_business_units (business_unit_id);

-- Backfill: copy any existing single-BU assignments into the junction table.
-- Skips apps that are already Global (target_bu_id IS NULL) and soft-deleted apps.
INSERT INTO application_business_units (application_id, business_unit_id)
SELECT a.id, a.target_bu_id
FROM applications a
WHERE a.target_bu_id IS NOT NULL
  AND a.deleted_at IS NULL
ON CONFLICT DO NOTHING;
