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

CREATE SEQUENCE IF NOT EXISTS lims_sample_number_seq;

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

CREATE UNIQUE INDEX IF NOT EXISTS users_username_global_uq ON users(lower(username));
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


-- EWASCO LIMS Phase 1-6 domain foundation.
-- These tables are additive and keep the existing structured LIMS + legacy JSONB model intact.

CREATE TABLE IF NOT EXISTS sampling_schedules(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL, name text NOT NULL, sampling_point_id uuid REFERENCES sampling_points(id) ON DELETE RESTRICT,
  frequency text NOT NULL, next_due_at timestamptz, active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,code)
);
CREATE TABLE IF NOT EXISTS sample_containers(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sample_id uuid NOT NULL REFERENCES samples(id) ON DELETE CASCADE, container_code text NOT NULL,
  container_type text, preservative text, volume numeric, unit text, condition text,
  collected_at timestamptz, received_at timestamptz, temperature numeric, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,container_code)
);
CREATE TABLE IF NOT EXISTS chain_of_custody(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sample_id uuid NOT NULL REFERENCES samples(id) ON DELETE CASCADE, coc_no text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_TRANSIT','RECEIVED','CLOSED','EXCEPTION')),
  collector_id uuid REFERENCES users(id) ON DELETE SET NULL, collected_at timestamptz,
  received_by uuid REFERENCES users(id) ON DELETE SET NULL, received_at timestamptz,
  transport_details text, receipt_condition text, exception_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,coc_no)
);
CREATE TABLE IF NOT EXISTS custody_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  chain_id uuid NOT NULL REFERENCES chain_of_custody(id) ON DELETE CASCADE, event_type text NOT NULL,
  from_user_id uuid REFERENCES users(id) ON DELETE SET NULL, to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_at timestamptz NOT NULL DEFAULT now(), notes text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS analytical_batches(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_no text NOT NULL, batch_type text NOT NULL CHECK(batch_type IN ('ANALYTICAL','PREPARATION','QC','CALIBRATION')),
  method_id uuid REFERENCES test_methods(id) ON DELETE RESTRICT, status text NOT NULL DEFAULT 'OPEN',
  started_at timestamptz, completed_at timestamptz, accepted_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,batch_no)
);
CREATE TABLE IF NOT EXISTS batch_members(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES analytical_batches(id) ON DELETE CASCADE, sample_test_id uuid NOT NULL REFERENCES sample_tests(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(batch_id,sample_test_id)
);
CREATE TABLE IF NOT EXISTS qc_results(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES analytical_batches(id) ON DELETE SET NULL, sample_test_id uuid REFERENCES sample_tests(id) ON DELETE SET NULL,
  qc_type text NOT NULL CHECK(qc_type IN ('BLANK','DUPLICATE','SPIKE','LCS','CALIBRATION_CHECK','REFERENCE_MATERIAL')),
  value_numeric numeric, expected_value numeric, lower_limit numeric, upper_limit numeric,
  flag text NOT NULL DEFAULT 'NOT_EVALUATED' CHECK(flag IN ('PASS','FAIL','NOT_EVALUATED')),
  notes text, created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hold_time_rules(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  method_id uuid NOT NULL REFERENCES test_methods(id) ON DELETE CASCADE, hours numeric NOT NULL CHECK(hours>0),
  warning_hours numeric CHECK(warning_hours>=0), source_reference text, active boolean NOT NULL DEFAULT true,
  UNIQUE(organization_id,method_id)
);
CREATE TABLE IF NOT EXISTS calculations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sample_test_id uuid REFERENCES sample_tests(id) ON DELETE CASCADE, formula_code text NOT NULL,
  formula_version text NOT NULL, inputs jsonb NOT NULL DEFAULT '{}'::jsonb, output_value numeric,
  output_unit text, intermediates jsonb NOT NULL DEFAULT '{}'::jsonb, calculated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instruments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_no text NOT NULL, name text NOT NULL, manufacturer text, model text, serial_no text,
  location text, status text NOT NULL DEFAULT 'ACTIVE', calibration_due_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,asset_no)
);
CREATE TABLE IF NOT EXISTS instrument_interfaces(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instrument_id uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE, interface_type text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS instrument_files(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instrument_id uuid REFERENCES instruments(id) ON DELETE SET NULL, file_name text NOT NULL,
  mime text, size integer, sha256 text, stored_name text, imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid REFERENCES users(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'RECEIVED',
  error_message text
);
CREATE TABLE IF NOT EXISTS calibration_records(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instrument_id uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE, performed_at timestamptz NOT NULL,
  due_at timestamptz, status text NOT NULL CHECK(status IN ('PASS','FAIL','OUT_OF_TOLERANCE')),
  standard_reference text, points jsonb NOT NULL DEFAULT '[]'::jsonb, certificate_file text,
  performed_by uuid REFERENCES users(id) ON DELETE SET NULL, notes text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS controlled_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_no text NOT NULL, title text NOT NULL, document_type text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REVIEW','APPROVED','SUPERSEDED','RETIRED')),
  current_version text, owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,document_no)
);
CREATE TABLE IF NOT EXISTS document_versions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES controlled_documents(id) ON DELETE CASCADE, version text NOT NULL,
  file_name text, mime text, size integer, sha256 text, stored_name text,
  effective_date date, approved_by uuid REFERENCES users(id) ON DELETE SET NULL, approved_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id,version)
);
CREATE TABLE IF NOT EXISTS training_records(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, competency text NOT NULL,
  status text NOT NULL DEFAULT 'CURRENT' CHECK(status IN ('CURRENT','DUE','EXPIRED','SUSPENDED')),
  assessed_at timestamptz, expires_at timestamptz, evidence_document_id uuid REFERENCES controlled_documents(id) ON DELETE SET NULL,
  assessor_id uuid REFERENCES users(id) ON DELETE SET NULL, notes text
);
CREATE TABLE IF NOT EXISTS deviations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deviation_no text NOT NULL, title text NOT NULL, description text NOT NULL, severity text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','INVESTIGATION','ACTION','CLOSED')),
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL, due_at timestamptz, closed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,deviation_no)
);
CREATE TABLE IF NOT EXISTS capa_actions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  capa_no text NOT NULL, source_type text NOT NULL, source_id text, description text NOT NULL,
  action_type text NOT NULL CHECK(action_type IN ('CORRECTIVE','PREVENTIVE')), owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  due_at timestamptz, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','VERIFICATION','CLOSED')),
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL, verified_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,capa_no)
);
CREATE TABLE IF NOT EXISTS audit_plans(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  audit_no text NOT NULL, audit_type text NOT NULL, scope text, scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'PLANNED', lead_id uuid REFERENCES users(id) ON DELETE SET NULL,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,audit_no)
);
CREATE TABLE IF NOT EXISTS change_controls(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  change_no text NOT NULL, title text NOT NULL, rationale text, impact_assessment text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REVIEW','APPROVED','IMPLEMENTED','CLOSED')),
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL, approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  implemented_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,change_no)
);

CREATE TABLE IF NOT EXISTS reports(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_no text NOT NULL, report_type text NOT NULL, sample_id uuid REFERENCES samples(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REVIEW','APPROVED','ISSUED','VOID')),
  version integer NOT NULL DEFAULT 1, issued_at timestamptz, issued_by uuid REFERENCES users(id) ON DELETE SET NULL,
  file_name text, sha256 text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,report_no,version)
);
CREATE TABLE IF NOT EXISTS notifications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE, event_type text NOT NULL, severity text NOT NULL DEFAULT 'INFO',
  title text NOT NULL, message text NOT NULL, entity text, record_id text, read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS integration_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source text NOT NULL, event_type text NOT NULL, external_id text, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED', error_message text, received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS schedules_org_due_idx ON sampling_schedules(organization_id,active,next_due_at);
CREATE INDEX IF NOT EXISTS containers_sample_idx ON sample_containers(organization_id,sample_id);
CREATE INDEX IF NOT EXISTS custody_sample_idx ON chain_of_custody(organization_id,sample_id);
CREATE INDEX IF NOT EXISTS batch_org_status_idx ON analytical_batches(organization_id,status);
CREATE INDEX IF NOT EXISTS qc_batch_idx ON qc_results(organization_id,batch_id);
CREATE INDEX IF NOT EXISTS instruments_org_status_idx ON instruments(organization_id,status);
CREATE INDEX IF NOT EXISTS documents_org_status_idx ON controlled_documents(organization_id,status);
CREATE INDEX IF NOT EXISTS deviations_org_status_idx ON deviations(organization_id,status);
CREATE INDEX IF NOT EXISTS capa_org_status_idx ON capa_actions(organization_id,status);
CREATE INDEX IF NOT EXISTS reports_org_status_idx ON reports(organization_id,status);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications(organization_id,user_id,read_at,created_at DESC);
