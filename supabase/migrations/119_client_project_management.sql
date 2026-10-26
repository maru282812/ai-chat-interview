-- Additive management metadata. Existing records remain unclassified/un-numbered.
-- Deploy before the application. Rollback: deploy previous application; retain
-- these nullable columns to preserve any newly entered management information.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_code text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_clients_company_code
  ON clients (upper(company_code)) WHERE company_code IS NOT NULL;
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS management_year integer CHECK (management_year BETWEEN 1900 AND 9999),
  ADD COLUMN IF NOT EXISTS confirmed_number integer CHECK (confirmed_number > 0),
  ADD COLUMN IF NOT EXISTS survey_purpose text CHECK (survey_purpose IN ('monitor', 'store'));
-- Numbers belong to the client across years; multiple clients may use number 1.
CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_client_confirmed_number
  ON projects (client_id, confirmed_number)
  WHERE client_id IS NOT NULL AND confirmed_number IS NOT NULL;
COMMIT;
