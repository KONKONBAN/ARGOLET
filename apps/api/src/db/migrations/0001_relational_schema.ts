/**
 * Migration 1 — the relational schema of ARGOLET.
 *
 * Frozen once released: never edit this text (its checksum is recorded in
 * argolet.schema_migrations); add a new migration file instead.
 *
 * Conventions
 *  - one table per business object, typed columns (numeric for money, timestamptz, date, boolean…);
 *    jsonb only for value objects that are always read and written with their parent
 *    (document lines, WBS tasks, allocations…), exposed relationally through the v_* views;
 *  - tenant-owned tables are keyed (tenant_id, id); every reference between tenant tables is a
 *    composite foreign key that includes tenant_id, so a row can never point into another tenant;
 *  - foreign keys are DEFERRABLE INITIALLY DEFERRED: a command writes an aggregate in any order and
 *    integrity is checked when its transaction commits;
 *  - CHECK constraints mirror the validation of the application (enumerations, formats, ranges);
 *  - history tables (audit log, document versions, evidence receipts…) are append-only, enforced by
 *    triggers.
 */
export const sql = String.raw`
-- ───────────────────────── helpers ─────────────────────────

COMMENT ON SCHEMA argolet IS 'ARGOLET – dữ liệu nghiệp vụ: chứng từ, đối soát, phê duyệt, chốt kỳ, bằng chứng toàn vẹn và các phân hệ G1–G4';

CREATE DOMAIN argolet.period_id AS text CHECK (VALUE ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
COMMENT ON DOMAIN argolet.period_id IS 'Kỳ kế toán theo tháng, dạng YYYY-MM';
CREATE DOMAIN argolet.currency_code AS text CHECK (VALUE ~ '^[A-Z]{3}$');
COMMENT ON DOMAIN argolet.currency_code IS 'Mã tiền tệ ISO 4217 (VND, USD…)';
CREATE DOMAIN argolet.sha256_hex AS text CHECK (VALUE ~ '^[0-9a-f]{64}$');
COMMENT ON DOMAIN argolet.sha256_hex IS 'Giá trị băm SHA-256 / HMAC dạng hex chữ thường';
CREATE DOMAIN argolet.hex_text AS text CHECK (VALUE ~ '^[0-9a-f]+$');
COMMENT ON DOMAIN argolet.hex_text IS 'Chuỗi hex chữ thường (muối, mã tham chiếu lô, rút gọn băm)';
CREATE DOMAIN argolet.non_negative AS numeric CHECK (VALUE >= 0);
COMMENT ON DOMAIN argolet.non_negative IS 'Số tiền / số lượng không âm';
CREATE DOMAIN argolet.email_address AS text CHECK (VALUE ~ '^[^@\s]+@[^@\s]+$');
COMMENT ON DOMAIN argolet.email_address IS 'Địa chỉ email';

-- jsonb array of strings -> text[] (NULL stays NULL); used when writing text[] columns.
CREATE FUNCTION argolet.jsonb_text_array(j jsonb) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT CASE WHEN j IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(j)) END $$;

-- Strict ISO-8601 input. PostgreSQL would otherwise also accept '01/12/2026' and read it
-- according to DateStyle (12 January or 1 December): dates and timestamps are only accepted in
-- the unambiguous forms the application writes.
CREATE FUNCTION argolet.iso_date(v text) RETURNS date
  LANGUAGE plpgsql STABLE STRICT PARALLEL SAFE
  AS $$
BEGIN
  IF v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Ngày phải theo định dạng YYYY-MM-DD: "%"', v USING ERRCODE = 'invalid_datetime_format';
  END IF;
  RETURN v::date;
END
$$;
CREATE FUNCTION argolet.iso_timestamp(v text) RETURNS timestamptz
  LANGUAGE plpgsql STABLE STRICT PARALLEL SAFE
  AS $$
BEGIN
  IF v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN
    RAISE EXCEPTION 'Thời điểm phải theo ISO-8601 có múi giờ: "%"', v USING ERRCODE = 'invalid_datetime_format';
  END IF;
  RETURN v::timestamptz;
END
$$;

-- Append-only guard. Arguments: the columns that may still change (besides rev / updated_at).
CREATE FUNCTION argolet.guard_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'argolet.%: bản ghi % chỉ được ghi thêm, không được xoá', TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- TG_ARGV is NULL when the trigger has no arguments.
  IF (to_jsonb(NEW) - coalesce(TG_ARGV, '{}') - 'rev' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - coalesce(TG_ARGV, '{}') - 'rev' - 'updated_at') THEN
    RAISE EXCEPTION 'argolet.%: bản ghi % chỉ được ghi thêm, không được sửa', TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ───────────────────────── identity & access (platform-wide) ─────────────────────────

CREATE TABLE argolet.users (
  id                      text        NOT NULL,
  full_name               text        NOT NULL CHECK (btrim(full_name) <> ''),
  email                   argolet.email_address,
  phone                   text,
  status                  text        NOT NULL CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'LOCKED')),
  verified_at             timestamptz,
  totp_secret             text,
  mfa_enabled_at          timestamptz,
  failed_logins           integer     NOT NULL CHECK (failed_logins >= 0),
  locked_until            timestamptz,
  last_login_at           timestamptz,
  pending_invitation_code text,
  rev                     integer     NOT NULL CHECK (rev >= 1),
  created_at              timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL,
  PRIMARY KEY (id),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_key ON argolet.users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_phone_key ON argolet.users (phone) WHERE phone IS NOT NULL;
COMMENT ON TABLE argolet.users IS 'Tài khoản người dùng (dùng chung mọi tổ chức); đăng nhập bằng email hoặc số điện thoại';

CREATE TABLE argolet.credentials (
  id                  text        NOT NULL,
  user_id             text        NOT NULL,
  password_hash       text        NOT NULL CHECK (password_hash <> ''),
  password_updated_at timestamptz NOT NULL,
  rev                 integer     NOT NULL CHECK (rev >= 1),
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (user_id)
);
COMMENT ON TABLE argolet.credentials IS 'Mật khẩu đã băm (Argon2id / scrypt) – tách khỏi bảng người dùng';

CREATE TABLE argolet.verification_tokens (
  id           text        NOT NULL,
  user_id      text        NOT NULL,
  purpose      text        NOT NULL CHECK (purpose IN ('VERIFY_CONTACT', 'RESET_PASSWORD', 'STEP_UP')),
  token_hash   argolet.sha256_hex NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     integer     NOT NULL CHECK (attempts >= 0),
  consumed_at  timestamptz,
  sent_to      text        NOT NULL,
  last_sent_at timestamptz NOT NULL,
  rev          integer     NOT NULL CHECK (rev >= 1),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX verification_tokens_user_idx ON argolet.verification_tokens (user_id, purpose);
COMMENT ON TABLE argolet.verification_tokens IS 'Mã xác minh một lần (xác minh liên hệ, đặt lại mật khẩu, xác thực bước hai) – chỉ lưu giá trị băm';

CREATE TABLE argolet.tenants (
  id             text        NOT NULL,
  name           text        NOT NULL CHECK (btrim(name) <> ''),
  org_type       text        NOT NULL,
  tax_code       text,
  policy_version text        NOT NULL,
  settings       jsonb       NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  created_by     text        NOT NULL,
  rev            integer     NOT NULL CHECK (rev >= 1),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX tenants_created_by_idx ON argolet.tenants (created_by);
COMMENT ON TABLE argolet.tenants IS 'Tổ chức (không gian làm việc) – đơn vị cô lập dữ liệu; settings: tiền tệ, múi giờ, chế độ kế toán, kỳ hiện tại, gói G1–G4';

CREATE TABLE argolet.sessions (
  id               text        NOT NULL,
  user_id          text        NOT NULL,
  token_hash       argolet.sha256_hex NOT NULL,
  channel          text        NOT NULL CHECK (channel IN ('web', 'mobile')),
  aal              integer     NOT NULL CHECK (aal IN (1, 2)),
  expires_at       timestamptz NOT NULL,
  last_seen_at     timestamptz NOT NULL,
  user_agent       text        NOT NULL,
  ip               text        NOT NULL,
  remember         boolean     NOT NULL,
  active_tenant_id text,
  active_entity_id text        NOT NULL,
  revoked_at       timestamptz,
  step_up_at       timestamptz,
  rev              integer     NOT NULL CHECK (rev >= 1),
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (token_hash)
);
CREATE INDEX sessions_user_idx ON argolet.sessions (user_id);
CREATE INDEX sessions_active_tenant_idx ON argolet.sessions (active_tenant_id);
COMMENT ON TABLE argolet.sessions IS 'Phiên đăng nhập (web / di động) – chỉ lưu giá trị băm của mã phiên; aal = mức xác thực';

CREATE TABLE argolet.invitations (
  id                text        NOT NULL,
  org_tenant_id     text        NOT NULL,
  org_name          text        NOT NULL,
  code              text        NOT NULL,
  email             argolet.email_address NOT NULL,
  role              text        NOT NULL CHECK (role IN ('ORG_ADMIN', 'ACCOUNTANT', 'CHIEF_ACCOUNTANT', 'APPROVER', 'STAFF', 'VIEWER', 'AUDITOR', 'CLIENT_DELEGATE', 'GROUP_CONTROLLER')),
  entity_ids        jsonb       NOT NULL CHECK (jsonb_typeof(entity_ids) = 'array' OR entity_ids = '"*"'::jsonb),
  scope_label       text        NOT NULL,
  permissions_label text        NOT NULL,
  approval_limit    argolet.non_negative,
  invited_by        text        NOT NULL,
  inviter_name      text        NOT NULL,
  expires_at        timestamptz NOT NULL,
  status            text        NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  rev               integer     NOT NULL CHECK (rev >= 1),
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (code)
);
CREATE INDEX invitations_tenant_idx ON argolet.invitations (org_tenant_id);
CREATE INDEX invitations_email_idx ON argolet.invitations (lower(email));
CREATE INDEX invitations_invited_by_idx ON argolet.invitations (invited_by);
COMMENT ON TABLE argolet.invitations IS 'Lời mời tham gia tổ chức với vai trò, phạm vi đơn vị và hạn mức phê duyệt';

CREATE TABLE argolet.ledger_states (
  id         text        NOT NULL,
  state      jsonb       NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  rev        integer     NOT NULL CHECK (rev >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id)
);
COMMENT ON TABLE argolet.ledger_states IS 'Trạng thái sổ cái neo bằng chứng (kênh permissioned): khối, giao dịch đã cam kết';

-- ───────────────────────── organisation ─────────────────────────

CREATE TABLE argolet.legal_entities (
  tenant_id     text        NOT NULL,
  id            text        NOT NULL,
  name          text        NOT NULL CHECK (btrim(name) <> ''),
  short_name    text        NOT NULL,
  code          text        NOT NULL CHECK (btrim(code) <> ''),
  kind          text        NOT NULL CHECK (kind IN ('LEGAL_ENTITY', 'SITE')),
  parent_id     text,
  base_currency argolet.currency_code NOT NULL,
  timezone      text        NOT NULL,
  rev           integer     NOT NULL CHECK (rev >= 1),
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX legal_entities_name_key ON argolet.legal_entities (tenant_id, lower(name));
CREATE INDEX legal_entities_parent_idx ON argolet.legal_entities (tenant_id, parent_id);
COMMENT ON TABLE argolet.legal_entities IS 'Cơ cấu tổ chức: pháp nhân (LEGAL_ENTITY) và cơ sở / chi nhánh (SITE, thuộc một pháp nhân)';

CREATE TABLE argolet.memberships (
  tenant_id    text        NOT NULL,
  id           text        NOT NULL,
  user_id      text        NOT NULL,
  display_name text        NOT NULL,
  title        text        NOT NULL,
  bindings     jsonb       NOT NULL CHECK (jsonb_typeof(bindings) = 'array'),
  status       text        NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INVITED')),
  scope_label  text        NOT NULL,
  limit_label  text        NOT NULL,
  rev          integer     NOT NULL CHECK (rev >= 1),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON argolet.memberships (user_id);
COMMENT ON TABLE argolet.memberships IS 'Thành viên của tổ chức; bindings = các vai trò kèm phạm vi pháp nhân và hạn mức phê duyệt (xem v_membership_roles)';

CREATE TABLE argolet.integrations (
  tenant_id    text        NOT NULL,
  id           text        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('POS', 'PLATFORM', 'BANK', 'EINVOICE', 'PAPER', 'EXCEL')),
  name         text        NOT NULL,
  description  text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('CONNECTED', 'AVAILABLE', 'PAUSED')),
  scope        text        NOT NULL,
  connected_at timestamptz,
  rev          integer     NOT NULL CHECK (rev >= 1),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
COMMENT ON TABLE argolet.integrations IS 'Nguồn dữ liệu kết nối: POS, nền tảng giao đồ ăn, ngân hàng, hoá đơn điện tử, giấy tờ, Excel';

-- ───────────────────────── intake & documents ─────────────────────────

CREATE TABLE argolet.import_batches (
  tenant_id      text        NOT NULL,
  id             text        NOT NULL,
  code           text        NOT NULL,
  entity_id      text        NOT NULL,
  source_kind    text        NOT NULL CHECK (source_kind IN ('PHOTO', 'XML_EINVOICE', 'BANK', 'CSV', 'PDF', 'POS', 'EXCEL', 'MIXED')),
  location       text        NOT NULL,
  status         text        NOT NULL CHECK (status IN ('RECEIVED', 'PROCESSING', 'READY', 'NEEDS_REVIEW')),
  file_count     integer     NOT NULL CHECK (file_count >= 0),
  normalized     integer     NOT NULL CHECK (normalized >= 0),
  needs_review   integer     NOT NULL CHECK (needs_review >= 0),
  duplicates     integer     NOT NULL CHECK (duplicates >= 0),
  created_by     text        NOT NULL,
  parser_version text        NOT NULL,
  rev            integer     NOT NULL CHECK (rev >= 1),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE INDEX import_batches_entity_idx ON argolet.import_batches (tenant_id, entity_id);
CREATE INDEX import_batches_created_by_idx ON argolet.import_batches (created_by);
COMMENT ON TABLE argolet.import_batches IS 'Lô tiếp nhận chứng từ (một lần tải lên / nhận tệp) và kết quả chuẩn hoá';

CREATE TABLE argolet.source_artifacts (
  tenant_id     text        NOT NULL,
  id            text        NOT NULL,
  batch_id      text        NOT NULL,
  filename      text        NOT NULL,
  mime          text        NOT NULL,
  size          bigint      NOT NULL CHECK (size >= 0),
  raw_sha256    argolet.sha256_hex NOT NULL,
  object_uri    text        NOT NULL,
  source_key    text        NOT NULL,
  received_at   timestamptz NOT NULL,
  duplicate_of  text,
  content       text,
  content_bom   boolean,
  content_exact boolean,
  rev           integer     NOT NULL CHECK (rev >= 1),
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (duplicate_of IS NULL OR duplicate_of <> id)
);
CREATE INDEX source_artifacts_batch_idx ON argolet.source_artifacts (tenant_id, batch_id);
CREATE INDEX source_artifacts_sha_idx ON argolet.source_artifacts (tenant_id, raw_sha256);
CREATE INDEX source_artifacts_duplicate_idx ON argolet.source_artifacts (tenant_id, duplicate_of) WHERE duplicate_of IS NOT NULL;
COMMENT ON TABLE argolet.source_artifacts IS 'Tệp gốc đã tiếp nhận: SHA-256 trên đúng từng byte, vị trí lưu trữ, nội dung văn bản (XML/CSV) để đối chiếu lại';

CREATE TABLE argolet.documents (
  tenant_id       text        NOT NULL,
  id              text        NOT NULL,
  code            text        NOT NULL,
  title           text        NOT NULL,
  counterparty    text        NOT NULL,
  source_kind     text        NOT NULL CHECK (source_kind IN ('PHOTO', 'XML_EINVOICE', 'BANK', 'CSV', 'PDF', 'POS', 'EXCEL')),
  entity_id       text        NOT NULL,
  document_date   date        NOT NULL,
  amount          numeric     NOT NULL,
  status          text        NOT NULL CHECK (status IN ('RECEIVED', 'EXTRACTED', 'NEEDS_REVIEW', 'VALIDATED', 'REJECTED', 'NEEDS_RECON')),
  current_version integer     NOT NULL CHECK (current_version >= 0),
  artifact_id     text,
  batch_id        text,
  fields          jsonb       NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  lines           jsonb       NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  vat             argolet.non_negative,
  structured_rows jsonb       NOT NULL CHECK (jsonb_typeof(structured_rows) = 'array'),
  row_kind        text        CHECK (row_kind IN ('BANK', 'POS')),
  extraction      jsonb       CHECK (jsonb_typeof(extraction) = 'object'),
  issues          jsonb       NOT NULL CHECK (jsonb_typeof(issues) = 'array'),
  received_at     timestamptz NOT NULL,
  received_by     text        NOT NULL,
  validated_by    text,
  validated_at    timestamptz,
  kind            text        NOT NULL CHECK (kind IN ('EXPENSE', 'REVENUE', 'STATEMENT', 'OTHER')),
  rev             integer     NOT NULL CHECK (rev >= 1),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK ((validated_by IS NULL) = (validated_at IS NULL))
);
CREATE INDEX documents_entity_idx ON argolet.documents (tenant_id, entity_id, document_date);
CREATE INDEX documents_status_idx ON argolet.documents (tenant_id, status);
CREATE INDEX documents_artifact_idx ON argolet.documents (tenant_id, artifact_id);
CREATE INDEX documents_batch_idx ON argolet.documents (tenant_id, batch_id);
CREATE INDEX documents_received_by_idx ON argolet.documents (received_by);
CREATE INDEX documents_validated_by_idx ON argolet.documents (validated_by);
CREATE INDEX documents_created_idx ON argolet.documents (tenant_id, created_at);
COMMENT ON TABLE argolet.documents IS 'Chứng từ: hoá đơn, sao kê, báo cáo POS / nền tảng, phiếu giao… với trường đã trích xuất, dòng chi tiết và vấn đề cần kiểm tra';

CREATE TABLE argolet.document_versions (
  tenant_id         text        NOT NULL,
  id                text        NOT NULL,
  document_id       text        NOT NULL,
  version           integer     NOT NULL CHECK (version >= 1),
  artifact_id       text,
  parser_version    text        NOT NULL,
  fields            jsonb       NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  field_locator     text        NOT NULL,
  confirmed_by      text        NOT NULL,
  confirmed_by_name text        NOT NULL,
  confirmed_at      timestamptz NOT NULL,
  note              text        NOT NULL,
  fingerprint       argolet.sha256_hex NOT NULL,
  salt              argolet.hex_text NOT NULL,
  rev               integer     NOT NULL CHECK (rev >= 1),
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, document_id, version)
);
CREATE INDEX document_versions_artifact_idx ON argolet.document_versions (tenant_id, artifact_id);
CREATE INDEX document_versions_confirmed_by_idx ON argolet.document_versions (confirmed_by);
COMMENT ON TABLE argolet.document_versions IS 'Phiên bản đã xác nhận của chứng từ (bất biến): trường dữ liệu, người xác nhận, dấu vân tay có muối để neo bằng chứng';

CREATE TABLE argolet.business_records (
  tenant_id      text        NOT NULL,
  id             text        NOT NULL,
  record_id      text        NOT NULL,
  version        integer     NOT NULL CHECK (version >= 1),
  entity_id      text        NOT NULL,
  kind           text        NOT NULL CHECK (kind IN ('ORDER', 'BANK_TXN', 'CASH', 'EXPENSE', 'REVENUE')),
  code           text        NOT NULL,
  amount         numeric     NOT NULL,
  currency       argolet.currency_code NOT NULL,
  record_date    date        NOT NULL,
  channel        text        NOT NULL,
  counterparty   text        NOT NULL,
  reference      text        NOT NULL,
  payout_batch   text        NOT NULL,
  description    text,
  fee            numeric     NOT NULL,
  refund         numeric     NOT NULL,
  discount       numeric     NOT NULL,
  adjustment     numeric     NOT NULL,
  document_id    text,
  match_group_id text,
  period_id      argolet.period_id NOT NULL,
  rev            integer     NOT NULL CHECK (rev >= 1),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (id = record_id)
);
CREATE INDEX business_records_period_idx ON argolet.business_records (tenant_id, entity_id, period_id);
CREATE INDEX business_records_document_idx ON argolet.business_records (tenant_id, document_id);
CREATE INDEX business_records_group_idx ON argolet.business_records (tenant_id, match_group_id);
CREATE INDEX business_records_open_idx ON argolet.business_records (tenant_id, entity_id, period_id) WHERE match_group_id IS NULL;
COMMENT ON TABLE argolet.business_records IS 'Bản ghi nghiệp vụ hiện hành (đơn hàng, giao dịch ngân hàng, tiền mặt, chi phí, doanh thu) sinh ra từ chứng từ đã xác nhận';

CREATE TABLE argolet.business_record_history (
  tenant_id      text        NOT NULL,
  id             text        NOT NULL,
  record_id      text        NOT NULL,
  version        integer     NOT NULL CHECK (version >= 1),
  entity_id      text        NOT NULL,
  kind           text        NOT NULL CHECK (kind IN ('ORDER', 'BANK_TXN', 'CASH', 'EXPENSE', 'REVENUE')),
  code           text        NOT NULL,
  amount         numeric     NOT NULL,
  currency       argolet.currency_code NOT NULL,
  record_date    date        NOT NULL,
  channel        text        NOT NULL,
  counterparty   text        NOT NULL,
  reference      text        NOT NULL,
  payout_batch   text        NOT NULL,
  description    text,
  fee            numeric     NOT NULL,
  refund         numeric     NOT NULL,
  discount       numeric     NOT NULL,
  adjustment     numeric     NOT NULL,
  document_id    text,
  match_group_id text,
  period_id      argolet.period_id NOT NULL,
  rev            integer     NOT NULL CHECK (rev >= 1),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, record_id, version)
);
COMMENT ON TABLE argolet.business_record_history IS 'Các phiên bản cũ của bản ghi nghiệp vụ (bất biến)';

CREATE TABLE argolet.record_evidence (
  tenant_id        text        NOT NULL,
  id               text        NOT NULL,
  record_id        text        NOT NULL,
  record_version   integer     NOT NULL CHECK (record_version >= 1),
  document_id      text        NOT NULL,
  document_version integer     NOT NULL CHECK (document_version >= 1),
  field_locator    text        NOT NULL,
  rev              integer     NOT NULL CHECK (rev >= 1),
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX record_evidence_record_idx ON argolet.record_evidence (tenant_id, record_id);
CREATE INDEX record_evidence_document_idx ON argolet.record_evidence (tenant_id, document_id, document_version);
COMMENT ON TABLE argolet.record_evidence IS 'Liên kết bản ghi nghiệp vụ ↔ phiên bản chứng từ và vị trí trường dữ liệu làm căn cứ (bất biến)';

-- ───────────────────────── reconciliation ─────────────────────────

CREATE TABLE argolet.recon_runs (
  tenant_id             text        NOT NULL,
  id                    text        NOT NULL,
  entity_id             text        NOT NULL,
  period_id             argolet.period_id NOT NULL,
  input_snapshot_digest argolet.sha256_hex NOT NULL,
  rules_version         text        NOT NULL,
  group_ids             text[]      NOT NULL,
  unmatched_orders      text[]      NOT NULL,
  unmatched_txns        text[]      NOT NULL,
  created_by            text        NOT NULL,
  rev                   integer     NOT NULL CHECK (rev >= 1),
  created_at            timestamptz NOT NULL,
  updated_at            timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX recon_runs_period_idx ON argolet.recon_runs (tenant_id, entity_id, period_id);
CREATE INDEX recon_runs_created_by_idx ON argolet.recon_runs (created_by);
COMMENT ON TABLE argolet.recon_runs IS 'Lần chạy đối soát: ảnh chụp dữ liệu đầu vào (digest), phiên bản quy tắc, nhóm đề xuất và khoản chưa khớp';

CREATE TABLE argolet.match_groups (
  tenant_id              text        NOT NULL,
  id                     text        NOT NULL,
  code                   text        NOT NULL,
  run_id                 text,
  entity_id              text        NOT NULL,
  period_id              argolet.period_id NOT NULL,
  kind                   text        NOT NULL CHECK (kind IN ('ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY')),
  status                 text        NOT NULL CHECK (status IN ('PROPOSED', 'PENDING_APPROVAL', 'CONFIRMED', 'DISCREPANCY')),
  source_label           text        NOT NULL,
  order_ids              text[]      NOT NULL,
  txn_ids                text[]      NOT NULL,
  gross                  numeric     NOT NULL,
  fee                    numeric     NOT NULL,
  refund                 numeric     NOT NULL,
  discount               numeric     NOT NULL,
  adjustment             numeric     NOT NULL,
  net                    numeric     NOT NULL,
  received               numeric     NOT NULL,
  residual               numeric     NOT NULL,
  score                  double precision NOT NULL CHECK (score >= 0 AND score <= 1),
  links                  jsonb       NOT NULL CHECK (jsonb_typeof(links) = 'array'),
  allocations            jsonb       NOT NULL CHECK (jsonb_typeof(allocations) = 'array'),
  explanation            text        NOT NULL,
  basis                  text[]      NOT NULL,
  fee_rule               text        NOT NULL,
  input_snapshot_version argolet.hex_text NOT NULL,
  rules_version          text        NOT NULL,
  confirmed_by           text,
  confirmed_at           timestamptz,
  approval_id            text,
  version                integer     NOT NULL CHECK (version >= 1),
  rev                    integer     NOT NULL CHECK (rev >= 1),
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL))
);
CREATE INDEX match_groups_period_idx ON argolet.match_groups (tenant_id, entity_id, period_id);
CREATE INDEX match_groups_status_idx ON argolet.match_groups (tenant_id, status);
CREATE INDEX match_groups_run_idx ON argolet.match_groups (tenant_id, run_id);
CREATE INDEX match_groups_approval_idx ON argolet.match_groups (tenant_id, approval_id);
CREATE INDEX match_groups_confirmed_by_idx ON argolet.match_groups (confirmed_by);
COMMENT ON TABLE argolet.match_groups IS 'Nhóm đối soát: đơn hàng ↔ khoản tiền về, tổng gộp / phí / hoàn / chiết khấu / thực nhận, chênh lệch, giải thích và phân bổ (xem v_match_allocations)';

-- ───────────────────────── approvals, close, evidence ─────────────────────────

CREATE TABLE argolet.approvals (
  tenant_id      text        NOT NULL,
  id             text        NOT NULL,
  approval_id    text        NOT NULL,
  entity_id      text        NOT NULL,
  target_type    text        NOT NULL CHECK (target_type IN ('EXPENSE', 'MATCH_GROUP', 'PERIOD_CLOSE', 'DECISION_PACK', 'TOOL_PROPOSAL', 'ALLOCATION', 'DAILY_CLOSE')),
  target_id      text        NOT NULL,
  target_version integer     NOT NULL CHECK (target_version >= 0),
  digest         argolet.hex_text NOT NULL,
  amount         numeric     NOT NULL,
  title          text        NOT NULL,
  maker_id       text        NOT NULL,
  status         text        NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED')),
  policy_version text        NOT NULL,
  decided_at     timestamptz,
  actor_id       text,
  comment        text,
  requester_name text        NOT NULL,
  entity_label   text        NOT NULL,
  details        jsonb       NOT NULL CHECK (jsonb_typeof(details) = 'array'),
  timeline       jsonb       NOT NULL CHECK (jsonb_typeof(timeline) = 'array'),
  due_date       date        NOT NULL,
  rev            integer     NOT NULL CHECK (rev >= 1),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (approval_id = id),
  CHECK (status = 'PENDING' OR decided_at IS NOT NULL)
);
CREATE INDEX approvals_status_idx ON argolet.approvals (tenant_id, status);
CREATE INDEX approvals_target_idx ON argolet.approvals (tenant_id, target_type, target_id);
CREATE INDEX approvals_entity_idx ON argolet.approvals (tenant_id, entity_id);
CREATE INDEX approvals_actor_idx ON argolet.approvals (actor_id);
COMMENT ON TABLE argolet.approvals IS 'Yêu cầu phê duyệt (người lập ≠ người duyệt) gắn với đúng phiên bản và digest của đối tượng; dòng thời gian xử lý';

CREATE TABLE argolet.accounting_periods (
  tenant_id           text        NOT NULL,
  id                  text        NOT NULL,
  entity_id           text        NOT NULL,
  period_id           argolet.period_id NOT NULL,
  status              text        NOT NULL CHECK (status IN ('OPEN', 'REVIEW', 'APPROVED', 'CLOSED')),
  close_memo_prepared boolean     NOT NULL,
  close_id            text,
  version             integer     NOT NULL CHECK (version >= 1),
  rev                 integer     NOT NULL CHECK (rev >= 1),
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, entity_id, period_id),
  CHECK (status <> 'CLOSED' OR close_id IS NOT NULL)
);
CREATE INDEX accounting_periods_close_idx ON argolet.accounting_periods (tenant_id, close_id);
COMMENT ON TABLE argolet.accounting_periods IS 'Kỳ kế toán theo từng đơn vị: mở → rà soát → duyệt → đã chốt';

CREATE TABLE argolet.close_snapshots (
  tenant_id         text        NOT NULL,
  id                text        NOT NULL,
  entity_id         text        NOT NULL,
  period_id         argolet.period_id NOT NULL,
  version           integer     NOT NULL CHECK (version >= 1),
  previous_close_id text,
  rules_version     text        NOT NULL,
  manifest          jsonb       NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  manifest_digest   argolet.sha256_hex NOT NULL,
  approval_ids      text[]      NOT NULL,
  closed_by         text        NOT NULL,
  closed_at         timestamptz NOT NULL,
  evidence_status   text        NOT NULL CHECK (evidence_status IN ('PENDING', 'ANCHORED', 'FAILED')),
  rev               integer     NOT NULL CHECK (rev >= 1),
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, entity_id, period_id, version),
  CHECK (previous_close_id IS NULL OR previous_close_id <> id)
);
CREATE INDEX close_snapshots_previous_idx ON argolet.close_snapshots (tenant_id, previous_close_id);
CREATE INDEX close_snapshots_closed_by_idx ON argolet.close_snapshots (closed_by);
COMMENT ON TABLE argolet.close_snapshots IS 'Ảnh chụp chốt kỳ (bất biến trừ trạng thái neo bằng chứng): manifest các bản ghi, nguồn, phê duyệt và tổng số; digest được neo';

CREATE TABLE argolet.evidence_batches (
  tenant_id      text        NOT NULL,
  id             text        NOT NULL,
  code           text        NOT NULL,
  batch_ref      argolet.hex_text NOT NULL,
  merkle_root    argolet.sha256_hex NOT NULL,
  schema_version text        NOT NULL,
  leaves         jsonb       NOT NULL CHECK (jsonb_typeof(leaves) = 'array'),
  receipt        jsonb       CHECK (jsonb_typeof(receipt) = 'object'),
  rev            integer     NOT NULL CHECK (rev >= 1),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
COMMENT ON TABLE argolet.evidence_batches IS 'Lô bằng chứng: cây Merkle trên các lá có muối (xem v_evidence_leaves) và biên nhận neo vào sổ cái';

CREATE TABLE argolet.evidence_receipts (
  tenant_id       text        NOT NULL,
  id              text        NOT NULL,
  target_type     text        NOT NULL CHECK (target_type IN ('CLOSE', 'DOCUMENT_VERSION')),
  target_id       text        NOT NULL,
  target_version  integer     NOT NULL CHECK (target_version >= 1),
  batch_id        text        NOT NULL,
  batch_code      text        NOT NULL,
  merkle_root     argolet.sha256_hex NOT NULL,
  leaf_index      integer     NOT NULL CHECK (leaf_index >= 0),
  transaction_id  argolet.hex_text NOT NULL,
  block_number    bigint      NOT NULL CHECK (block_number >= 0),
  channel         text        NOT NULL,
  validation_code text        NOT NULL,
  committed_at    timestamptz NOT NULL,
  rev             integer     NOT NULL CHECK (rev >= 1),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, target_type, target_id, target_version)
);
CREATE INDEX evidence_receipts_batch_idx ON argolet.evidence_receipts (tenant_id, batch_id);
COMMENT ON TABLE argolet.evidence_receipts IS 'Biên nhận bằng chứng của từng đối tượng (chốt kỳ / phiên bản chứng từ): lô, gốc Merkle, giao dịch và khối trên sổ cái (bất biến)';

CREATE TABLE argolet.evidence_verifications (
  tenant_id    text        NOT NULL,
  id           text        NOT NULL,
  target_type  text        NOT NULL CHECK (target_type IN ('CLOSE', 'DOCUMENT_VERSION')),
  target_id    text        NOT NULL,
  ok           boolean     NOT NULL,
  steps        jsonb       NOT NULL CHECK (jsonb_typeof(steps) = 'array'),
  requested_by text        NOT NULL,
  rev          integer     NOT NULL CHECK (rev >= 1),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX evidence_verifications_target_idx ON argolet.evidence_verifications (tenant_id, target_type, target_id);
CREATE INDEX evidence_verifications_requested_by_idx ON argolet.evidence_verifications (requested_by);
COMMENT ON TABLE argolet.evidence_verifications IS 'Nhật ký kiểm tra toàn vẹn: từng bước kiểm tra và kết quả (bất biến)';

-- ───────────────────────── finance, assistant, notifications, audit ─────────────────────────

CREATE TABLE argolet.calc_runs (
  tenant_id             text        NOT NULL,
  id                    text        NOT NULL,
  calc_run_id           text        NOT NULL,
  task                  text        NOT NULL,
  package_code          text        NOT NULL CHECK (package_code IN ('G1', 'G2', 'G3', 'G4')),
  input_snapshot_digest argolet.sha256_hex NOT NULL,
  rules_version         text        NOT NULL,
  engine_version        text        NOT NULL,
  assumptions           jsonb,
  method                text        NOT NULL,
  result                jsonb,
  created_by            text        NOT NULL,
  rev                   integer     NOT NULL CHECK (rev >= 1),
  created_at            timestamptz NOT NULL,
  updated_at            timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (calc_run_id = id)
);
CREATE INDEX calc_runs_created_by_idx ON argolet.calc_runs (created_by);
COMMENT ON TABLE argolet.calc_runs IS 'Lần tính toán tài chính có thể tái lập: giả định, phương pháp, phiên bản động cơ và kết quả (bất biến)';

CREATE TABLE argolet.finance_projects (
  tenant_id        text        NOT NULL,
  id               text        NOT NULL,
  code             text        NOT NULL,
  name             text        NOT NULL,
  assumptions      jsonb       NOT NULL CHECK (jsonb_typeof(assumptions) = 'object'),
  scenarios        jsonb       NOT NULL CHECK (jsonb_typeof(scenarios) = 'array'),
  last_calc_run_id text,
  rev              integer     NOT NULL CHECK (rev >= 1),
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE INDEX finance_projects_calc_idx ON argolet.finance_projects (tenant_id, last_calc_run_id);
COMMENT ON TABLE argolet.finance_projects IS 'Dự án thẩm định tài chính (NPV / IRR / hoàn vốn) và các kịch bản';

CREATE TABLE argolet.assistant_conversations (
  tenant_id  text        NOT NULL,
  id         text        NOT NULL,
  user_id    text        NOT NULL,
  title      text        NOT NULL,
  messages   jsonb       NOT NULL CHECK (jsonb_typeof(messages) = 'array'),
  rev        integer     NOT NULL CHECK (rev >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX assistant_conversations_user_idx ON argolet.assistant_conversations (tenant_id, user_id);
CREATE INDEX assistant_conversations_user_ref_idx ON argolet.assistant_conversations (user_id);
COMMENT ON TABLE argolet.assistant_conversations IS 'Hội thoại với trợ lý ARGOLET: câu hỏi, trả lời kèm trích dẫn nguồn và đề xuất hành động';

CREATE TABLE argolet.notifications (
  tenant_id       text        NOT NULL,
  id              text        NOT NULL,
  user_id         text,
  title           text        NOT NULL,
  unit_label      text        NOT NULL,
  ref_code        text        NOT NULL,
  route           text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('UNREAD', 'READ')),
  action_required boolean     NOT NULL,
  status_label    text,
  rev             integer     NOT NULL CHECK (rev >= 1),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX notifications_inbox_idx ON argolet.notifications (tenant_id, status, created_at);
CREATE INDEX notifications_user_idx ON argolet.notifications (user_id);
COMMENT ON TABLE argolet.notifications IS 'Thông báo trong ứng dụng (toàn tổ chức hoặc riêng một người dùng)';

CREATE TABLE argolet.audit_log (
  tenant_id      text        NOT NULL,
  id             text        NOT NULL,
  actor_id       text        NOT NULL,
  actor_name     text        NOT NULL,
  action         text        NOT NULL,
  target         text        NOT NULL,
  detail         text        NOT NULL,
  correlation_id text        NOT NULL,
  rev            integer     NOT NULL CHECK (rev >= 1),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX audit_log_time_idx ON argolet.audit_log (tenant_id, created_at);
CREATE INDEX audit_log_actor_idx ON argolet.audit_log (tenant_id, actor_id);
CREATE INDEX audit_log_correlation_idx ON argolet.audit_log (correlation_id);
COMMENT ON TABLE argolet.audit_log IS 'Nhật ký kiểm toán: ai làm gì, trên đối tượng nào, khi nào (bất biến; giữ lại cả khi người dùng bị xoá)';

-- ───────────────────────── events (transactional outbox / inbox) ─────────────────────────

CREATE TABLE argolet.event_outbox (
  tenant_id    text        NOT NULL,
  id           text        NOT NULL,
  event        jsonb       NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  published_at timestamptz,
  rev          integer     NOT NULL CHECK (rev >= 1),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (event->>'eventId' = id)
);
CREATE INDEX event_outbox_pending_idx ON argolet.event_outbox (created_at) WHERE published_at IS NULL;
COMMENT ON TABLE argolet.event_outbox IS 'Hộp thư đi của sự kiện miền (DomainEvent), ghi cùng giao dịch với dữ liệu; published_at = đã phát';

CREATE TABLE argolet.event_inbox (
  tenant_id  text        NOT NULL,
  id         text        NOT NULL,
  consumer   text        NOT NULL,
  event_id   text        NOT NULL,
  rev        integer     NOT NULL CHECK (rev >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, consumer, event_id),
  CHECK (id = consumer || ':' || event_id)
);
COMMENT ON TABLE argolet.event_inbox IS 'Hộp thư đến của từng bộ xử lý sự kiện: bảo đảm mỗi sự kiện chỉ được xử lý một lần (bất biến)';

CREATE TABLE argolet.aggregate_sequences (
  tenant_id  text        NOT NULL,
  id         text        NOT NULL,
  seq        bigint      NOT NULL CHECK (seq >= 0),
  rev        integer     NOT NULL CHECK (rev >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
COMMENT ON TABLE argolet.aggregate_sequences IS 'Số thứ tự sự kiện của từng aggregate (bảo đảm thứ tự xử lý)';

CREATE TABLE argolet.read_projections (
  tenant_id  text        NOT NULL,
  id         text        NOT NULL,
  name       text        NOT NULL,
  as_of_seq  bigint      NOT NULL CHECK (as_of_seq >= 0),
  data       jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  rev        integer     NOT NULL CHECK (rev >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
COMMENT ON TABLE argolet.read_projections IS 'Bảng đọc tính sẵn (dashboard) cập nhật từ sự kiện';

-- ───────────────────────── modules G1–G4 ─────────────────────────

CREATE TABLE argolet.inventory_items (
  tenant_id     text        NOT NULL,
  id            text        NOT NULL,
  entity_id     text        NOT NULL,
  name          text        NOT NULL CHECK (btrim(name) <> ''),
  unit          text        NOT NULL,
  on_hand       argolet.non_negative NOT NULL,
  reorder_level argolet.non_negative NOT NULL,
  unit_cost     argolet.non_negative NOT NULL,
  rev           integer     NOT NULL CHECK (rev >= 1),
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX inventory_items_name_key ON argolet.inventory_items (tenant_id, entity_id, lower(name));
COMMENT ON TABLE argolet.inventory_items IS 'G1 · Nguyên vật liệu / hàng tồn kho theo cơ sở';

CREATE TABLE argolet.recipes (
  tenant_id  text        NOT NULL,
  id         text        NOT NULL,
  name       text        NOT NULL CHECK (btrim(name) <> ''),
  price      argolet.non_negative NOT NULL,
  waste_rate argolet.non_negative NOT NULL,
  lines      jsonb       NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  rev        integer     NOT NULL CHECK (rev >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
COMMENT ON TABLE argolet.recipes IS 'G1 · Định mức món / sản phẩm: giá bán, tỷ lệ hao hụt, các dòng nguyên liệu (xem v_recipe_lines)';

CREATE TABLE argolet.purchase_orders (
  tenant_id   text        NOT NULL,
  id          text        NOT NULL,
  code        text        NOT NULL,
  supplier    text        NOT NULL,
  entity_id   text        NOT NULL,
  order_date  date        NOT NULL,
  due_date    date        NOT NULL,
  amount      numeric     NOT NULL,
  outstanding numeric     NOT NULL,
  status      text        NOT NULL CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'RECEIVED', 'AWAITING_INVOICE', 'PAID')),
  rev         integer     NOT NULL CHECK (rev >= 1),
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE INDEX purchase_orders_entity_idx ON argolet.purchase_orders (tenant_id, entity_id);
COMMENT ON TABLE argolet.purchase_orders IS 'G1 · Đơn mua hàng: nhà cung cấp, hạn thanh toán, số còn phải trả';

CREATE TABLE argolet.daily_closes (
  tenant_id     text        NOT NULL,
  id            text        NOT NULL,
  entity_id     text        NOT NULL,
  business_date date        NOT NULL,
  shift         text        NOT NULL,
  lines         jsonb       NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  status        text        NOT NULL CHECK (status IN ('OPEN', 'SUBMITTED')),
  submitted_by  text,
  submitted_at  timestamptz,
  rev           integer     NOT NULL CHECK (rev >= 1),
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (status = 'OPEN' OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL))
);
CREATE INDEX daily_closes_entity_idx ON argolet.daily_closes (tenant_id, entity_id, business_date);
CREATE INDEX daily_closes_submitted_by_idx ON argolet.daily_closes (submitted_by);
COMMENT ON TABLE argolet.daily_closes IS 'G1 · Chốt ca / chốt ngày: số hệ thống và số thực kiểm theo kênh thu';

CREATE TABLE argolet.clients (
  tenant_id              text        NOT NULL,
  id                     text        NOT NULL,
  name                   text        NOT NULL,
  scope                  text        NOT NULL,
  completion             integer     NOT NULL CHECK (completion BETWEEN 0 AND 100),
  close_due              date        NOT NULL,
  status                 text        NOT NULL CHECK (status IN ('MISSING_DOCS', 'READY', 'REVIEWED', 'WAITING')),
  missing_docs           integer     NOT NULL CHECK (missing_docs >= 0),
  delegation_valid_until date        NOT NULL,
  rev                    integer     NOT NULL CHECK (rev >= 1),
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
COMMENT ON TABLE argolet.clients IS 'G2 · Khách hàng dịch vụ kế toán: tiến độ hồ sơ, hạn chốt, uỷ quyền';

CREATE TABLE argolet.deals (
  tenant_id  text        NOT NULL,
  id         text        NOT NULL,
  code       text        NOT NULL,
  customer   text        NOT NULL,
  stage      text        NOT NULL CHECK (stage IN ('OPPORTUNITY', 'QUOTE', 'CONTRACT', 'DELIVERY', 'INVOICE', 'COLLECTION')),
  deal_value numeric     NOT NULL,
  status     text        NOT NULL CHECK (status IN ('WAITING_REPLY', 'IN_PROGRESS', 'DUE', 'DONE')),
  due_date   date        NOT NULL,
  rev        integer     NOT NULL CHECK (rev >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE INDEX deals_stage_idx ON argolet.deals (tenant_id, stage);
COMMENT ON TABLE argolet.deals IS 'G2 · Cơ hội / hợp đồng bán hàng theo giai đoạn: cơ hội → báo giá → hợp đồng → giao → hoá đơn → thu tiền';

CREATE TABLE argolet.projects (
  tenant_id  text        NOT NULL,
  id         text        NOT NULL,
  code       text        NOT NULL,
  name       text        NOT NULL,
  manager    text        NOT NULL,
  budget     argolet.non_negative NOT NULL,
  recorded   argolet.non_negative NOT NULL,
  committed  argolet.non_negative NOT NULL,
  wbs        jsonb       NOT NULL CHECK (jsonb_typeof(wbs) = 'array'),
  rev        integer     NOT NULL CHECK (rev >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
COMMENT ON TABLE argolet.projects IS 'G3 · Dự án: ngân sách, chi phí đã ghi nhận / đã cam kết, cấu trúc công việc WBS (xem v_project_tasks)';

CREATE TABLE argolet.assets (
  tenant_id    text        NOT NULL,
  id           text        NOT NULL,
  code         text        NOT NULL,
  name         text        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('ASSET', 'METRIC')),
  project_code text        NOT NULL,
  baseline     argolet.non_negative,
  reporting    argolet.non_negative,
  unit         text        NOT NULL,
  schedule     text        NOT NULL,
  due_date     date,
  status       text        NOT NULL CHECK (status IN ('MONITORING', 'MAINTENANCE_DUE', 'OK')),
  rev          integer     NOT NULL CHECK (rev >= 1),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE INDEX assets_project_idx ON argolet.assets (tenant_id, project_code);
COMMENT ON TABLE argolet.assets IS 'G3 · Tài sản vận hành và chỉ số đo lường (đường cơ sở / kỳ báo cáo), lịch bảo trì';

CREATE TABLE argolet.shipments (
  tenant_id            text        NOT NULL,
  id                   text        NOT NULL,
  code                 text        NOT NULL,
  route                text        NOT NULL,
  container            text        NOT NULL,
  status               text        NOT NULL CHECK (status IN ('IN_TRANSIT', 'CUSTOMS', 'DELIVERING', 'DELIVERED')),
  events               jsonb       NOT NULL CHECK (jsonb_typeof(events) = 'array'),
  documents            jsonb       NOT NULL CHECK (jsonb_typeof(documents) = 'array'),
  free_time_start      date        NOT NULL,
  free_days            integer     NOT NULL CHECK (free_days >= 0),
  tariff_code          text        NOT NULL,
  tariff_from          date        NOT NULL,
  storage_rate_per_day argolet.non_negative NOT NULL,
  storage_days         integer     NOT NULL CHECK (storage_days >= 0),
  revenue              argolet.non_negative NOT NULL,
  costs                jsonb       NOT NULL CHECK (jsonb_typeof(costs) = 'array'),
  allocation           jsonb       NOT NULL CHECK (jsonb_typeof(allocation) = 'array'),
  allocation_confirmed boolean     NOT NULL,
  rev                  integer     NOT NULL CHECK (rev >= 1),
  created_at           timestamptz NOT NULL,
  updated_at           timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
COMMENT ON TABLE argolet.shipments IS 'G3 · Lô hàng logistics: hành trình, chứng từ, thời gian miễn phí lưu bãi, chi phí và phân bổ (xem v_shipment_costs)';

CREATE TABLE argolet.group_entities (
  tenant_id      text        NOT NULL,
  id             text        NOT NULL,
  entity_id      text        NOT NULL,
  name           text        NOT NULL,
  code           text        NOT NULL,
  docs_submitted integer     NOT NULL CHECK (docs_submitted >= 0),
  docs_total     integer     NOT NULL CHECK (docs_total >= 0),
  period_status  text        NOT NULL CHECK (period_status IN ('SUBMITTED', 'PENDING')),
  ic_status      text        NOT NULL,
  rev            integer     NOT NULL CHECK (rev >= 1),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, entity_id),
  CHECK (docs_submitted <= docs_total)
);
COMMENT ON TABLE argolet.group_entities IS 'G4 · Tình trạng nộp hồ sơ kỳ của từng pháp nhân trong tập đoàn';

CREATE TABLE argolet.intercompany_pairs (
  tenant_id    text        NOT NULL,
  id           text        NOT NULL,
  reference    text        NOT NULL,
  contract     text        NOT NULL,
  period_id    argolet.period_id NOT NULL,
  side_a       jsonb       NOT NULL CHECK (jsonb_typeof(side_a) = 'object' AND side_a->>'role' = 'RECEIVABLE'),
  side_b       jsonb       NOT NULL CHECK (jsonb_typeof(side_b) = 'object' AND side_b->>'role' = 'PAYABLE'),
  status       text        NOT NULL CHECK (status IN ('MATCHED', 'DIFFERENCE', 'REQUESTED')),
  next_action  text        NOT NULL,
  requested_at timestamptz,
  rev          integer     NOT NULL CHECK (rev >= 1),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, period_id, reference)
);
COMMENT ON TABLE argolet.intercompany_pairs IS 'G4 · Cặp giao dịch nội bộ giữa hai pháp nhân (phải thu ↔ phải trả) và trạng thái khớp';

-- ───────────────────────── foreign keys ─────────────────────────
-- Every reference is checked at commit (DEFERRABLE INITIALLY DEFERRED) and never cascades:
-- business data is never removed implicitly.

ALTER TABLE argolet.credentials ADD CONSTRAINT credentials_user_fk FOREIGN KEY (user_id) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.verification_tokens ADD CONSTRAINT verification_tokens_user_fk FOREIGN KEY (user_id) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.sessions ADD CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.sessions ADD CONSTRAINT sessions_active_tenant_fk FOREIGN KEY (active_tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.tenants ADD CONSTRAINT tenants_created_by_fk FOREIGN KEY (created_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.invitations ADD CONSTRAINT invitations_tenant_fk FOREIGN KEY (org_tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.invitations ADD CONSTRAINT invitations_invited_by_fk FOREIGN KEY (invited_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;

-- tenant ownership
ALTER TABLE argolet.legal_entities ADD CONSTRAINT legal_entities_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.memberships ADD CONSTRAINT memberships_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.integrations ADD CONSTRAINT integrations_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.import_batches ADD CONSTRAINT import_batches_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.source_artifacts ADD CONSTRAINT source_artifacts_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.documents ADD CONSTRAINT documents_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.document_versions ADD CONSTRAINT document_versions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.business_records ADD CONSTRAINT business_records_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.business_record_history ADD CONSTRAINT business_record_history_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.record_evidence ADD CONSTRAINT record_evidence_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.recon_runs ADD CONSTRAINT recon_runs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.match_groups ADD CONSTRAINT match_groups_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.approvals ADD CONSTRAINT approvals_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.accounting_periods ADD CONSTRAINT accounting_periods_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.close_snapshots ADD CONSTRAINT close_snapshots_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.evidence_batches ADD CONSTRAINT evidence_batches_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.evidence_receipts ADD CONSTRAINT evidence_receipts_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.evidence_verifications ADD CONSTRAINT evidence_verifications_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.calc_runs ADD CONSTRAINT calc_runs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.finance_projects ADD CONSTRAINT finance_projects_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.assistant_conversations ADD CONSTRAINT assistant_conversations_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.notifications ADD CONSTRAINT notifications_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.audit_log ADD CONSTRAINT audit_log_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.read_projections ADD CONSTRAINT read_projections_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.inventory_items ADD CONSTRAINT inventory_items_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.recipes ADD CONSTRAINT recipes_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.purchase_orders ADD CONSTRAINT purchase_orders_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.daily_closes ADD CONSTRAINT daily_closes_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.clients ADD CONSTRAINT clients_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.deals ADD CONSTRAINT deals_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.projects ADD CONSTRAINT projects_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.assets ADD CONSTRAINT assets_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.shipments ADD CONSTRAINT shipments_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.group_entities ADD CONSTRAINT group_entities_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.intercompany_pairs ADD CONSTRAINT intercompany_pairs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;

-- references inside a tenant (composite: the target must belong to the same tenant)
ALTER TABLE argolet.legal_entities ADD CONSTRAINT legal_entities_parent_fk FOREIGN KEY (tenant_id, parent_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.import_batches ADD CONSTRAINT import_batches_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.source_artifacts ADD CONSTRAINT source_artifacts_batch_fk FOREIGN KEY (tenant_id, batch_id) REFERENCES argolet.import_batches (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.source_artifacts ADD CONSTRAINT source_artifacts_duplicate_fk FOREIGN KEY (tenant_id, duplicate_of) REFERENCES argolet.source_artifacts (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.documents ADD CONSTRAINT documents_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.documents ADD CONSTRAINT documents_artifact_fk FOREIGN KEY (tenant_id, artifact_id) REFERENCES argolet.source_artifacts (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.documents ADD CONSTRAINT documents_batch_fk FOREIGN KEY (tenant_id, batch_id) REFERENCES argolet.import_batches (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.document_versions ADD CONSTRAINT document_versions_document_fk FOREIGN KEY (tenant_id, document_id) REFERENCES argolet.documents (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.document_versions ADD CONSTRAINT document_versions_artifact_fk FOREIGN KEY (tenant_id, artifact_id) REFERENCES argolet.source_artifacts (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.business_records ADD CONSTRAINT business_records_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.business_records ADD CONSTRAINT business_records_document_fk FOREIGN KEY (tenant_id, document_id) REFERENCES argolet.documents (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.business_records ADD CONSTRAINT business_records_group_fk FOREIGN KEY (tenant_id, match_group_id) REFERENCES argolet.match_groups (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.business_record_history ADD CONSTRAINT business_record_history_record_fk FOREIGN KEY (tenant_id, record_id) REFERENCES argolet.business_records (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.record_evidence ADD CONSTRAINT record_evidence_record_fk FOREIGN KEY (tenant_id, record_id) REFERENCES argolet.business_records (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
-- the document version itself may still be pending: statements awaiting reconciliation (NEEDS_RECON)
-- get their confirmed version only when every linked match group is confirmed.
ALTER TABLE argolet.record_evidence ADD CONSTRAINT record_evidence_document_fk FOREIGN KEY (tenant_id, document_id) REFERENCES argolet.documents (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.recon_runs ADD CONSTRAINT recon_runs_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.match_groups ADD CONSTRAINT match_groups_run_fk FOREIGN KEY (tenant_id, run_id) REFERENCES argolet.recon_runs (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.match_groups ADD CONSTRAINT match_groups_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.match_groups ADD CONSTRAINT match_groups_approval_fk FOREIGN KEY (tenant_id, approval_id) REFERENCES argolet.approvals (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.approvals ADD CONSTRAINT approvals_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.accounting_periods ADD CONSTRAINT accounting_periods_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.accounting_periods ADD CONSTRAINT accounting_periods_close_fk FOREIGN KEY (tenant_id, close_id) REFERENCES argolet.close_snapshots (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.close_snapshots ADD CONSTRAINT close_snapshots_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.close_snapshots ADD CONSTRAINT close_snapshots_previous_fk FOREIGN KEY (tenant_id, previous_close_id) REFERENCES argolet.close_snapshots (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.evidence_receipts ADD CONSTRAINT evidence_receipts_batch_fk FOREIGN KEY (tenant_id, batch_id) REFERENCES argolet.evidence_batches (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.finance_projects ADD CONSTRAINT finance_projects_calc_fk FOREIGN KEY (tenant_id, last_calc_run_id) REFERENCES argolet.calc_runs (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.inventory_items ADD CONSTRAINT inventory_items_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.purchase_orders ADD CONSTRAINT purchase_orders_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.daily_closes ADD CONSTRAINT daily_closes_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.group_entities ADD CONSTRAINT group_entities_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;

-- people (platform-wide user accounts)
ALTER TABLE argolet.memberships ADD CONSTRAINT memberships_user_fk FOREIGN KEY (user_id) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.import_batches ADD CONSTRAINT import_batches_created_by_fk FOREIGN KEY (created_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.documents ADD CONSTRAINT documents_received_by_fk FOREIGN KEY (received_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.documents ADD CONSTRAINT documents_validated_by_fk FOREIGN KEY (validated_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.document_versions ADD CONSTRAINT document_versions_confirmed_by_fk FOREIGN KEY (confirmed_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.recon_runs ADD CONSTRAINT recon_runs_created_by_fk FOREIGN KEY (created_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.match_groups ADD CONSTRAINT match_groups_confirmed_by_fk FOREIGN KEY (confirmed_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.approvals ADD CONSTRAINT approvals_actor_fk FOREIGN KEY (actor_id) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.close_snapshots ADD CONSTRAINT close_snapshots_closed_by_fk FOREIGN KEY (closed_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.evidence_verifications ADD CONSTRAINT evidence_verifications_requested_by_fk FOREIGN KEY (requested_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.calc_runs ADD CONSTRAINT calc_runs_created_by_fk FOREIGN KEY (created_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.assistant_conversations ADD CONSTRAINT assistant_conversations_user_fk FOREIGN KEY (user_id) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.notifications ADD CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.daily_closes ADD CONSTRAINT daily_closes_submitted_by_fk FOREIGN KEY (submitted_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;

-- ───────────────────────── append-only history ─────────────────────────

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON argolet.audit_log FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only();
CREATE TRIGGER document_versions_append_only BEFORE UPDATE OR DELETE ON argolet.document_versions FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only();
CREATE TRIGGER business_record_history_append_only BEFORE UPDATE OR DELETE ON argolet.business_record_history FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only();
CREATE TRIGGER record_evidence_append_only BEFORE UPDATE OR DELETE ON argolet.record_evidence FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only();
CREATE TRIGGER evidence_batches_append_only BEFORE UPDATE OR DELETE ON argolet.evidence_batches FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only('receipt');
CREATE TRIGGER evidence_receipts_append_only BEFORE UPDATE OR DELETE ON argolet.evidence_receipts FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only();
CREATE TRIGGER evidence_verifications_append_only BEFORE UPDATE OR DELETE ON argolet.evidence_verifications FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only();
CREATE TRIGGER close_snapshots_append_only BEFORE UPDATE OR DELETE ON argolet.close_snapshots FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only('evidence_status');
CREATE TRIGGER calc_runs_append_only BEFORE UPDATE OR DELETE ON argolet.calc_runs FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only();
CREATE TRIGGER event_inbox_append_only BEFORE UPDATE OR DELETE ON argolet.event_inbox FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only();

-- ───────────────────────── reporting views ─────────────────────────

CREATE VIEW argolet.v_match_allocations AS
  SELECT g.tenant_id, g.id AS group_id, g.code AS group_code, g.entity_id, g.period_id, g.status AS group_status,
         a->>'recordId' AS record_id, (a->>'recordVersion')::integer AS record_version, a->>'role' AS role,
         (a->>'allocatedAmount')::numeric AS allocated_amount, (a->>'remaining')::numeric AS remaining
    FROM argolet.match_groups g CROSS JOIN LATERAL jsonb_array_elements(g.allocations) a;
COMMENT ON VIEW argolet.v_match_allocations IS 'Phân bổ của từng nhóm đối soát xuống từng bản ghi (đơn hàng / khoản nhận tiền)';

CREATE VIEW argolet.v_close_snapshot_members AS
  SELECT s.tenant_id, s.id AS close_id, s.entity_id, s.period_id, s.version AS close_version,
         m->>'recordId' AS record_id, (m->>'recordVersion')::integer AS record_version, m->>'digest' AS member_digest
    FROM argolet.close_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.manifest->'members') m;
COMMENT ON VIEW argolet.v_close_snapshot_members IS 'Các bản ghi (đúng phiên bản và digest) nằm trong mỗi lần chốt kỳ';

CREATE VIEW argolet.v_evidence_leaves AS
  SELECT b.tenant_id, b.id AS batch_id, b.code AS batch_code, b.merkle_root,
         l->>'targetType' AS target_type, l->>'targetId' AS target_id, (l->>'targetVersion')::integer AS target_version,
         (l->>'leafIndex')::integer AS leaf_index, l->>'manifestDigest' AS manifest_digest, l->>'leaf' AS leaf
    FROM argolet.evidence_batches b CROSS JOIN LATERAL jsonb_array_elements(b.leaves) l;
COMMENT ON VIEW argolet.v_evidence_leaves IS 'Các lá Merkle của từng lô bằng chứng';

CREATE VIEW argolet.v_document_lines AS
  SELECT d.tenant_id, d.id AS document_id, d.code AS document_code, d.entity_id, d.document_date,
         l.ordinality::integer AS line_no, l.value->>'description' AS description, (l.value->>'amount')::numeric AS amount
    FROM argolet.documents d CROSS JOIN LATERAL jsonb_array_elements(d.lines) WITH ORDINALITY l;
COMMENT ON VIEW argolet.v_document_lines IS 'Dòng chi tiết của chứng từ (hàng hoá / dịch vụ, số tiền chưa VAT)';

CREATE VIEW argolet.v_membership_roles AS
  SELECT m.tenant_id, m.id AS membership_id, m.user_id, m.display_name, m.status,
         b->>'role' AS role, b->'entityIds' AS entity_scope, b->>'approvalLimit' AS approval_limit
    FROM argolet.memberships m CROSS JOIN LATERAL jsonb_array_elements(m.bindings) b;
COMMENT ON VIEW argolet.v_membership_roles IS 'Vai trò của từng thành viên: phạm vi pháp nhân (* = toàn tổ chức) và hạn mức phê duyệt';

CREATE VIEW argolet.v_project_tasks AS
  SELECT p.tenant_id, p.id AS project_id, p.code AS project_code, t->>'code' AS task_code, t->>'name' AS name,
         t->>'dependsOn' AS depends_on, t->>'owner' AS owner, (t->>'progress')::numeric AS progress, t->>'status' AS status
    FROM argolet.projects p CROSS JOIN LATERAL jsonb_array_elements(p.wbs) t;
COMMENT ON VIEW argolet.v_project_tasks IS 'Công việc WBS của dự án: phụ thuộc, người phụ trách, tiến độ';

CREATE VIEW argolet.v_shipment_costs AS
  SELECT s.tenant_id, s.id AS shipment_id, s.code AS shipment_code, c->>'name' AS name, c->>'basis' AS basis,
         (c->>'amount')::numeric AS amount
    FROM argolet.shipments s CROSS JOIN LATERAL jsonb_array_elements(s.costs) c;
COMMENT ON VIEW argolet.v_shipment_costs IS 'Chi phí của từng lô hàng';

CREATE VIEW argolet.v_recipe_lines AS
  SELECT r.tenant_id, r.id AS recipe_id, r.name AS recipe_name, l->>'itemId' AS item_id, l->>'name' AS item_name,
         (l->>'quantity')::numeric AS quantity, l->>'unit' AS unit, (l->>'unitCost')::numeric AS unit_cost
    FROM argolet.recipes r CROSS JOIN LATERAL jsonb_array_elements(r.lines) l;
COMMENT ON VIEW argolet.v_recipe_lines IS 'Định lượng nguyên liệu của từng món';

CREATE VIEW argolet.v_period_reconciliation AS
  SELECT g.tenant_id, g.entity_id, g.period_id,
         count(*) AS groups_total,
         count(*) FILTER (WHERE g.status = 'CONFIRMED') AS groups_confirmed,
         count(*) FILTER (WHERE g.status IN ('PROPOSED', 'PENDING_APPROVAL')) AS groups_to_confirm,
         count(*) FILTER (WHERE g.status = 'DISCREPANCY') AS discrepancies,
         sum(g.gross) AS gross, sum(g.fee) AS fee, sum(g.net) AS net, sum(g.received) AS received, sum(g.residual) AS residual
    FROM argolet.match_groups g
   GROUP BY g.tenant_id, g.entity_id, g.period_id;
COMMENT ON VIEW argolet.v_period_reconciliation IS 'Tổng hợp đối soát theo đơn vị và kỳ: số nhóm theo trạng thái, tổng gộp / phí / thực nhận / chênh lệch';
`;
