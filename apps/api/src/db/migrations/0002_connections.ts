/**
 * 0002 · Connections from ARGOLET to partners' APIs (bank via SePay, POS via KiotViet…) and the
 * log of every sync. Credentials are sealed with the server key (AES-256-GCM) before they reach
 * the database; the log is append-only.
 */
export const sql = String.raw`
CREATE TABLE argolet.connections (
  tenant_id         text        NOT NULL,
  id                text        NOT NULL,
  provider          text        NOT NULL CHECK (provider IN ('SEPAY', 'KIOTVIET')),
  label             text        NOT NULL CHECK (btrim(label) <> ''),
  status            text        NOT NULL CHECK (status IN ('ACTIVE', 'ERROR', 'DISCONNECTED')),
  config            jsonb       NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  secret_sealed     text,
  secret_hint       text        NOT NULL,
  cursor            text,
  entity_id         text        NOT NULL,
  connected_by      text        NOT NULL,
  connected_by_name text        NOT NULL,
  connected_at      timestamptz NOT NULL,
  last_sync_at      timestamptz,
  last_error        text,
  rev               integer     NOT NULL CHECK (rev >= 1),
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (status = 'DISCONNECTED' OR secret_sealed IS NOT NULL)
);
CREATE INDEX connections_entity_idx ON argolet.connections (tenant_id, entity_id);
CREATE INDEX connections_connected_by_idx ON argolet.connections (connected_by);
COMMENT ON TABLE argolet.connections IS 'Kết nối từ ARGOLET tới API của đối tác (ngân hàng qua SePay, POS qua KiotViet…); khóa truy cập được mã hóa AES-256-GCM bằng khóa máy chủ';

CREATE TABLE argolet.connection_runs (
  tenant_id     text        NOT NULL,
  id            text        NOT NULL,
  connection_id text        NOT NULL,
  provider      text        NOT NULL CHECK (provider IN ('SEPAY', 'KIOTVIET')),
  trigger       text        NOT NULL CHECK (trigger IN ('MANUAL', 'SCHEDULE', 'TEST')),
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz NOT NULL,
  status        text        NOT NULL CHECK (status IN ('SUCCESS', 'NO_CHANGE', 'FAILED')),
  fetched       integer     NOT NULL CHECK (fetched >= 0),
  imported      integer     NOT NULL CHECK (imported >= 0),
  requests      integer     NOT NULL CHECK (requests >= 0),
  document_id   text,
  document_code text,
  message       text        NOT NULL,
  actor_id      text        NOT NULL,
  actor_name    text        NOT NULL,
  rev           integer     NOT NULL CHECK (rev >= 1),
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (finished_at >= started_at),
  CHECK ((document_id IS NULL) = (document_code IS NULL))
);
CREATE INDEX connection_runs_connection_idx ON argolet.connection_runs (tenant_id, connection_id, started_at DESC);
CREATE INDEX connection_runs_document_idx ON argolet.connection_runs (tenant_id, document_id);
CREATE INDEX connection_runs_actor_idx ON argolet.connection_runs (actor_id);
COMMENT ON TABLE argolet.connection_runs IS 'Nhật ký từng lần kiểm tra / đồng bộ với đối tác: số bản ghi nhận, chứng từ tạo ra, lỗi (chỉ ghi thêm)';

ALTER TABLE argolet.connections ADD CONSTRAINT connections_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.connections ADD CONSTRAINT connections_entity_fk FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.connections ADD CONSTRAINT connections_connected_by_fk FOREIGN KEY (connected_by) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.connection_runs ADD CONSTRAINT connection_runs_connection_fk FOREIGN KEY (tenant_id, connection_id) REFERENCES argolet.connections (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.connection_runs ADD CONSTRAINT connection_runs_document_fk FOREIGN KEY (tenant_id, document_id) REFERENCES argolet.documents (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.connection_runs ADD CONSTRAINT connection_runs_actor_fk FOREIGN KEY (actor_id) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER connection_runs_append_only BEFORE UPDATE OR DELETE ON argolet.connection_runs FOR EACH ROW EXECUTE FUNCTION argolet.guard_append_only();
`;
