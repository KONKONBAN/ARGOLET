/**
 * 0003 · What the assistant has learnt: the organisation's terms, rules and corrected answers
 * (approved by an administrator before use), imported handbook pages, and each person's own
 * preferences.
 */
export const sql = String.raw`
CREATE TABLE argolet.assistant_knowledge (
  tenant_id       text        NOT NULL,
  id              text        NOT NULL,
  scope           text        NOT NULL CHECK (scope IN ('ORG', 'USER')),
  user_id         text,
  kind            text        NOT NULL CHECK (kind IN ('TERM', 'RULE', 'FAQ', 'DOCUMENT', 'PREFERENCE')),
  title           text        NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 200),
  content         text        NOT NULL CHECK (btrim(content) <> '' AND length(content) <= 8000),
  source          text        NOT NULL CHECK (source IN ('ADMIN', 'FEEDBACK', 'CONVERSATION', 'IMPORT')),
  status          text        NOT NULL CHECK (status IN ('ACTIVE', 'PENDING', 'REJECTED')),
  created_by      text        NOT NULL,
  created_by_name text        NOT NULL,
  reviewed_by     text,
  reviewed_at     timestamptz,
  rev             integer     NOT NULL CHECK (rev >= 1),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK ((scope = 'USER') = (user_id IS NOT NULL)),
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);
CREATE INDEX assistant_knowledge_status_idx ON argolet.assistant_knowledge (tenant_id, scope, status);
CREATE INDEX assistant_knowledge_user_idx ON argolet.assistant_knowledge (tenant_id, user_id);
CREATE INDEX assistant_knowledge_user_ref_idx ON argolet.assistant_knowledge (user_id);
COMMENT ON TABLE argolet.assistant_knowledge IS 'Kiến thức trợ lý học được: thuật ngữ, quy định, câu trả lời được sửa (quản trị viên duyệt trước khi dùng), tài liệu nhập và sở thích riêng của từng người';
ALTER TABLE argolet.assistant_knowledge ADD CONSTRAINT assistant_knowledge_tenant_fk FOREIGN KEY (tenant_id) REFERENCES argolet.tenants (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE argolet.assistant_knowledge ADD CONSTRAINT assistant_knowledge_user_fk FOREIGN KEY (user_id) REFERENCES argolet.users (id) DEFERRABLE INITIALLY DEFERRED;
`;
