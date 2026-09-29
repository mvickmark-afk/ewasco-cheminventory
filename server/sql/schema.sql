CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS organizations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  username text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK(role IN ('Administrator','Laboratory Manager','Analyst/Chemist','Storekeeper')),
  disabled boolean NOT NULL DEFAULT false,
  failed_login_attempts integer NOT NULL DEFAULT 0 CHECK(failed_login_attempts>=0 AND failed_login_attempts<=20),
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,username)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE TABLE IF NOT EXISTS sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS records(
  id text NOT NULL CHECK(length(id)<=120),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK(entity IN ('chemicals','batches','reagents','consumption','equipment','calibrations','suppliers','procurement','water','waste','sds','settings')),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,entity,id)
);

CREATE TABLE IF NOT EXISTS sds_versions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sds_id text NOT NULL,
  version integer NOT NULL,
  file_name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL,
  stored_name text NOT NULL,
  sha256 text NOT NULL,
  revision_date date,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,sds_id,version)
);

CREATE TABLE IF NOT EXISTS audit_log(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  record_id text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Structured LIMS core. These tables are intentionally separate from the legacy JSONB records
-- so analytical data has controlled fields, lifecycle status, ownership and immutable approvals.
CREATE TABLE IF NOT EXISTS sampling_points(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'GENERAL',
  location text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code)
);

CREATE TABLE IF NOT EXISTS test_methods(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  analyte text NOT NULL,
  matrix text,
  result_type text NOT NULL CHECK(result_type IN ('NUMERIC','TEXT','QUALITATIVE')),
  default_unit text,
  method_reference text,
  method_version text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code)
);

CREATE TABLE IF NOT EXISTS specifications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  parameter text NOT NULL,
  operator text NOT NULL CHECK(operator IN ('BETWEEN','LT','LTE','GT','GTE','EQ','NEQ','IS_NOT_NULL')),
  lower_limit numeric,
  upper_limit numeric,
  target_unit text,
  source_reference text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code),
  CHECK((operator='BETWEEN' AND lower_limit IS NOT NULL AND upper_limit IS NOT NULL AND lower_limit<=upper_limit)
     OR (operator IN ('LT','LTE','GT','GTE','EQ','NEQ') AND lower_limit IS NOT NULL)
     OR (operator='IS_NOT_NULL'))
);

CREATE TABLE IF NOT EXISTS samples(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sample_no text NOT NULL,
  sampling_point_id uuid REFERENCES sampling_points(id) ON DELETE RESTRICT,
  sample_type text NOT NULL,
  matrix text,
  status text NOT NULL CHECK(status IN ('REGISTERED','RECEIVED','IN_ANALYSIS','PENDING_REVIEW','APPROVED','REPORTED','ARCHIVED','CANCELLED')),
  collected_at timestamptz,
  received_at timestamptz,
  collected_by uuid REFERENCES users(id) ON DELETE SET NULL,
  received_by uuid REFERENCES users(id) ON DELETE SET NULL,
  registered_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,sample_no)
);

CREATE TABLE IF NOT EXISTS sample_tests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sample_id uuid NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  method_id uuid NOT NULL REFERENCES test_methods(id) ON DELETE RESTRICT,
  specification_id uuid REFERENCES specifications(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK(status IN ('PLANNED','ASSIGNED','IN_PROGRESS','RESULT_ENTERED','REVIEWED','APPROVED','REJECTED')),
  priority integer NOT NULL DEFAULT 100 CHECK(priority>=0 AND priority<=1000),
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  due_at timestamptz,
  started_at timestamptz,
  result_entered_at timestamptz,
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sample_id,method_id)
);

CREATE TABLE IF NOT EXISTS results(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sample_test_id uuid NOT NULL UNIQUE REFERENCES sample_tests(id) ON DELETE CASCADE,
  value_numeric numeric,
  value_text text,
  raw_value text NOT NULL,
  unit text,
  result_flag text NOT NULL DEFAULT 'NOT_EVALUATED' CHECK(result_flag IN ('PASS','FAIL','NOT_EVALUATED')),
  result_status text NOT NULL CHECK(result_status IN ('DRAFT','ENTERED','REVIEWED','APPROVED')),
  instrument_reference text,
  entered_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entered_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(value_numeric IS NOT NULL OR value_text IS NOT NULL),
  CHECK(NOT(value_numeric IS NOT NULL AND value_text IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS records_org_entity_updated_idx ON records(organization_id,entity,updated_at DESC);
CREATE INDEX IF NOT EXISTS audit_org_created_idx ON audit_log(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sds_versions_lookup_idx ON sds_versions(organization_id,sds_id,version DESC);
CREATE INDEX IF NOT EXISTS sampling_points_org_active_idx ON sampling_points(organization_id,active);
CREATE INDEX IF NOT EXISTS methods_org_active_idx ON test_methods(organization_id,active);
CREATE INDEX IF NOT EXISTS specs_org_active_idx ON specifications(organization_id,active);
CREATE INDEX IF NOT EXISTS samples_org_status_updated_idx ON samples(organization_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS sample_tests_org_status_idx ON sample_tests(organization_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS results_org_status_idx ON results(organization_id,result_status,updated_at DESC);
