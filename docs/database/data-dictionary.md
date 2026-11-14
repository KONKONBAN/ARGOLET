# Từ điển dữ liệu ARGOLET

> Sinh tự động từ lược đồ `argolet` (phiên bản 2) bằng `pnpm --filter @argolet/api db:docs`. Không sửa tay.

## Kiểu miền (domain)

| Kiểu | Nền | Ràng buộc | Ý nghĩa |
| --- | --- | --- | --- |
| `currency_code` | text | `CHECK ((VALUE ~ '^[A-Z]{3}$'::text))` | Mã tiền tệ ISO 4217 (VND, USD…) |
| `email_address` | text | `CHECK ((VALUE ~ '^[^@\s]+@[^@\s]+$'::text))` | Địa chỉ email |
| `hex_text` | text | `CHECK ((VALUE ~ '^[0-9a-f]+$'::text))` | Chuỗi hex chữ thường (muối, mã tham chiếu lô, rút gọn băm) |
| `non_negative` | numeric | `CHECK ((VALUE >= (0)::numeric))` | Số tiền / số lượng không âm |
| `period_id` | text | `CHECK ((VALUE ~ '^[0-9]{4}-(0[1-9]\|1[0-2])$'::text))` | Kỳ kế toán theo tháng, dạng YYYY-MM |
| `sha256_hex` | text | `CHECK ((VALUE ~ '^[0-9a-f]{64}$'::text))` | Giá trị băm SHA-256 / HMAC dạng hex chữ thường |

## Bảng

| Bảng | Mô tả |
| --- | --- |
| [`accounting_periods`](#accounting_periods) | Kỳ kế toán theo từng đơn vị: mở → rà soát → duyệt → đã chốt |
| [`aggregate_sequences`](#aggregate_sequences) | Số thứ tự sự kiện của từng aggregate (bảo đảm thứ tự xử lý) |
| [`approvals`](#approvals) | Yêu cầu phê duyệt (người lập ≠ người duyệt) gắn với đúng phiên bản và digest của đối tượng; dòng thời gian xử lý |
| [`assets`](#assets) | G3 · Tài sản vận hành và chỉ số đo lường (đường cơ sở / kỳ báo cáo), lịch bảo trì |
| [`assistant_conversations`](#assistant_conversations) | Hội thoại với trợ lý ARGOLET: câu hỏi, trả lời kèm trích dẫn nguồn và đề xuất hành động |
| [`audit_log`](#audit_log) | Nhật ký kiểm toán: ai làm gì, trên đối tượng nào, khi nào (bất biến; giữ lại cả khi người dùng bị xoá) |
| [`business_record_history`](#business_record_history) | Các phiên bản cũ của bản ghi nghiệp vụ (bất biến) |
| [`business_records`](#business_records) | Bản ghi nghiệp vụ hiện hành (đơn hàng, giao dịch ngân hàng, tiền mặt, chi phí, doanh thu) sinh ra từ chứng từ đã xác nhận |
| [`calc_runs`](#calc_runs) | Lần tính toán tài chính có thể tái lập: giả định, phương pháp, phiên bản động cơ và kết quả (bất biến) |
| [`clients`](#clients) | G2 · Khách hàng dịch vụ kế toán: tiến độ hồ sơ, hạn chốt, uỷ quyền |
| [`close_snapshots`](#close_snapshots) | Ảnh chụp chốt kỳ (bất biến trừ trạng thái neo bằng chứng): manifest các bản ghi, nguồn, phê duyệt và tổng số; digest được neo |
| [`connection_runs`](#connection_runs) | Nhật ký từng lần kiểm tra / đồng bộ với đối tác: số bản ghi nhận, chứng từ tạo ra, lỗi (chỉ ghi thêm) |
| [`connections`](#connections) | Kết nối từ ARGOLET tới API của đối tác (ngân hàng qua SePay, POS qua KiotViet…); khóa truy cập được mã hóa AES-256-GCM bằng khóa máy chủ |
| [`credentials`](#credentials) | Mật khẩu đã băm (Argon2id / scrypt) – tách khỏi bảng người dùng |
| [`daily_closes`](#daily_closes) | G1 · Chốt ca / chốt ngày: số hệ thống và số thực kiểm theo kênh thu |
| [`deals`](#deals) | G2 · Cơ hội / hợp đồng bán hàng theo giai đoạn: cơ hội → báo giá → hợp đồng → giao → hoá đơn → thu tiền |
| [`document_versions`](#document_versions) | Phiên bản đã xác nhận của chứng từ (bất biến): trường dữ liệu, người xác nhận, dấu vân tay có muối để neo bằng chứng |
| [`documents`](#documents) | Chứng từ: hoá đơn, sao kê, báo cáo POS / nền tảng, phiếu giao… với trường đã trích xuất, dòng chi tiết và vấn đề cần kiểm tra |
| [`event_inbox`](#event_inbox) | Hộp thư đến của từng bộ xử lý sự kiện: bảo đảm mỗi sự kiện chỉ được xử lý một lần (bất biến) |
| [`event_outbox`](#event_outbox) | Hộp thư đi của sự kiện miền (DomainEvent), ghi cùng giao dịch với dữ liệu; published_at = đã phát |
| [`evidence_batches`](#evidence_batches) | Lô bằng chứng: cây Merkle trên các lá có muối (xem v_evidence_leaves) và biên nhận neo vào sổ cái |
| [`evidence_receipts`](#evidence_receipts) | Biên nhận bằng chứng của từng đối tượng (chốt kỳ / phiên bản chứng từ): lô, gốc Merkle, giao dịch và khối trên sổ cái (bất biến) |
| [`evidence_verifications`](#evidence_verifications) | Nhật ký kiểm tra toàn vẹn: từng bước kiểm tra và kết quả (bất biến) |
| [`finance_projects`](#finance_projects) | Dự án thẩm định tài chính (NPV / IRR / hoàn vốn) và các kịch bản |
| [`group_entities`](#group_entities) | G4 · Tình trạng nộp hồ sơ kỳ của từng pháp nhân trong tập đoàn |
| [`import_batches`](#import_batches) | Lô tiếp nhận chứng từ (một lần tải lên / nhận tệp) và kết quả chuẩn hoá |
| [`integrations`](#integrations) | Nguồn dữ liệu kết nối: POS, nền tảng giao đồ ăn, ngân hàng, hoá đơn điện tử, giấy tờ, Excel |
| [`intercompany_pairs`](#intercompany_pairs) | G4 · Cặp giao dịch nội bộ giữa hai pháp nhân (phải thu ↔ phải trả) và trạng thái khớp |
| [`inventory_items`](#inventory_items) | G1 · Nguyên vật liệu / hàng tồn kho theo cơ sở |
| [`invitations`](#invitations) | Lời mời tham gia tổ chức với vai trò, phạm vi đơn vị và hạn mức phê duyệt |
| [`ledger_states`](#ledger_states) | Trạng thái sổ cái neo bằng chứng (kênh permissioned): khối, giao dịch đã cam kết |
| [`legal_entities`](#legal_entities) | Cơ cấu tổ chức: pháp nhân (LEGAL_ENTITY) và cơ sở / chi nhánh (SITE, thuộc một pháp nhân) |
| [`match_groups`](#match_groups) | Nhóm đối soát: đơn hàng ↔ khoản tiền về, tổng gộp / phí / hoàn / chiết khấu / thực nhận, chênh lệch, giải thích và phân bổ (xem v_match_allocations) |
| [`memberships`](#memberships) | Thành viên của tổ chức; bindings = các vai trò kèm phạm vi pháp nhân và hạn mức phê duyệt (xem v_membership_roles) |
| [`notifications`](#notifications) | Thông báo trong ứng dụng (toàn tổ chức hoặc riêng một người dùng) |
| [`projects`](#projects) | G3 · Dự án: ngân sách, chi phí đã ghi nhận / đã cam kết, cấu trúc công việc WBS (xem v_project_tasks) |
| [`purchase_orders`](#purchase_orders) | G1 · Đơn mua hàng: nhà cung cấp, hạn thanh toán, số còn phải trả |
| [`read_projections`](#read_projections) | Bảng đọc tính sẵn (dashboard) cập nhật từ sự kiện |
| [`recipes`](#recipes) | G1 · Định mức món / sản phẩm: giá bán, tỷ lệ hao hụt, các dòng nguyên liệu (xem v_recipe_lines) |
| [`recon_runs`](#recon_runs) | Lần chạy đối soát: ảnh chụp dữ liệu đầu vào (digest), phiên bản quy tắc, nhóm đề xuất và khoản chưa khớp |
| [`record_evidence`](#record_evidence) | Liên kết bản ghi nghiệp vụ ↔ phiên bản chứng từ và vị trí trường dữ liệu làm căn cứ (bất biến) |
| [`schema_migrations`](#schema_migrations) |  |
| [`sessions`](#sessions) | Phiên đăng nhập (web / di động) – chỉ lưu giá trị băm của mã phiên; aal = mức xác thực |
| [`shipments`](#shipments) | G3 · Lô hàng logistics: hành trình, chứng từ, thời gian miễn phí lưu bãi, chi phí và phân bổ (xem v_shipment_costs) |
| [`source_artifacts`](#source_artifacts) | Tệp gốc đã tiếp nhận: SHA-256 trên đúng từng byte, vị trí lưu trữ, nội dung văn bản (XML/CSV) để đối chiếu lại |
| [`tenants`](#tenants) | Tổ chức (không gian làm việc) – đơn vị cô lập dữ liệu; settings: tiền tệ, múi giờ, chế độ kế toán, kỳ hiện tại, gói G1–G4 |
| [`users`](#users) | Tài khoản người dùng (dùng chung mọi tổ chức); đăng nhập bằng email hoặc số điện thoại |
| [`verification_tokens`](#verification_tokens) | Mã xác minh một lần (xác minh liên hệ, đặt lại mật khẩu, xác thực bước hai) – chỉ lưu giá trị băm |

### accounting_periods

Kỳ kế toán theo từng đơn vị: mở → rà soát → duyệt → đã chốt

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `entity_id` | text | có |
| `period_id` | argolet.period_id | có |
| `status` | text | có |
| `close_memo_prepared` | boolean | có |
| `close_id` | text |  |
| `version` | integer | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `accounting_periods_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `accounting_periods_tenant_id_entity_id_period_id_key` | Duy nhất | `UNIQUE (tenant_id, entity_id, period_id)` |
| `accounting_periods_close_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, close_id) REFERENCES argolet.close_snapshots(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `accounting_periods_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `accounting_periods_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `accounting_periods_check` | Kiểm tra | `CHECK (((status <> 'CLOSED'::text) OR (close_id IS NOT NULL)))` |
| `accounting_periods_close_memo_prepared_not_null` | n | `NOT NULL close_memo_prepared` |
| `accounting_periods_created_at_not_null` | n | `NOT NULL created_at` |
| `accounting_periods_entity_id_not_null` | n | `NOT NULL entity_id` |
| `accounting_periods_id_not_null` | n | `NOT NULL id` |
| `accounting_periods_period_id_not_null` | n | `NOT NULL period_id` |
| `accounting_periods_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `accounting_periods_rev_not_null` | n | `NOT NULL rev` |
| `accounting_periods_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['OPEN'::text, 'REVIEW'::text, 'APPROVED'::text, 'CLOSED'::text])))` |
| `accounting_periods_status_not_null` | n | `NOT NULL status` |
| `accounting_periods_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `accounting_periods_updated_at_not_null` | n | `NOT NULL updated_at` |
| `accounting_periods_version_check` | Kiểm tra | `CHECK ((version >= 1))` |
| `accounting_periods_version_not_null` | n | `NOT NULL version` |

Chỉ mục:

- `accounting_periods_close_idx`: `argolet.accounting_periods USING btree (tenant_id, close_id)`

### aggregate_sequences

Số thứ tự sự kiện của từng aggregate (bảo đảm thứ tự xử lý)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `seq` | bigint | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `aggregate_sequences_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `aggregate_sequences_created_at_not_null` | n | `NOT NULL created_at` |
| `aggregate_sequences_id_not_null` | n | `NOT NULL id` |
| `aggregate_sequences_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `aggregate_sequences_rev_not_null` | n | `NOT NULL rev` |
| `aggregate_sequences_seq_check` | Kiểm tra | `CHECK ((seq >= 0))` |
| `aggregate_sequences_seq_not_null` | n | `NOT NULL seq` |
| `aggregate_sequences_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `aggregate_sequences_updated_at_not_null` | n | `NOT NULL updated_at` |

### approvals

Yêu cầu phê duyệt (người lập ≠ người duyệt) gắn với đúng phiên bản và digest của đối tượng; dòng thời gian xử lý

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `approval_id` | text | có |
| `entity_id` | text | có |
| `target_type` | text | có |
| `target_id` | text | có |
| `target_version` | integer | có |
| `digest` | argolet.hex_text | có |
| `amount` | numeric | có |
| `title` | text | có |
| `maker_id` | text | có |
| `status` | text | có |
| `policy_version` | text | có |
| `decided_at` | timestamp with time zone |  |
| `actor_id` | text |  |
| `comment` | text |  |
| `requester_name` | text | có |
| `entity_label` | text | có |
| `details` | jsonb | có |
| `timeline` | jsonb | có |
| `due_date` | date | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `approvals_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `approvals_actor_fk` | Khoá ngoại | `FOREIGN KEY (actor_id) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `approvals_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `approvals_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `approvals_amount_not_null` | n | `NOT NULL amount` |
| `approvals_approval_id_not_null` | n | `NOT NULL approval_id` |
| `approvals_check` | Kiểm tra | `CHECK ((approval_id = id))` |
| `approvals_check1` | Kiểm tra | `CHECK (((status = 'PENDING'::text) OR (decided_at IS NOT NULL)))` |
| `approvals_created_at_not_null` | n | `NOT NULL created_at` |
| `approvals_details_check` | Kiểm tra | `CHECK ((jsonb_typeof(details) = 'array'::text))` |
| `approvals_details_not_null` | n | `NOT NULL details` |
| `approvals_digest_not_null` | n | `NOT NULL digest` |
| `approvals_due_date_not_null` | n | `NOT NULL due_date` |
| `approvals_entity_id_not_null` | n | `NOT NULL entity_id` |
| `approvals_entity_label_not_null` | n | `NOT NULL entity_label` |
| `approvals_id_not_null` | n | `NOT NULL id` |
| `approvals_maker_id_not_null` | n | `NOT NULL maker_id` |
| `approvals_policy_version_not_null` | n | `NOT NULL policy_version` |
| `approvals_requester_name_not_null` | n | `NOT NULL requester_name` |
| `approvals_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `approvals_rev_not_null` | n | `NOT NULL rev` |
| `approvals_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CHANGES_REQUESTED'::text])))` |
| `approvals_status_not_null` | n | `NOT NULL status` |
| `approvals_target_id_not_null` | n | `NOT NULL target_id` |
| `approvals_target_type_check` | Kiểm tra | `CHECK ((target_type = ANY (ARRAY['EXPENSE'::text, 'MATCH_GROUP'::text, 'PERIOD_CLOSE'::text, 'DECISION_PACK'::text, 'TOOL_PROPOSAL'::text, 'ALLOCATION'::text, 'DAILY_CLOSE'::text])))` |
| `approvals_target_type_not_null` | n | `NOT NULL target_type` |
| `approvals_target_version_check` | Kiểm tra | `CHECK ((target_version >= 0))` |
| `approvals_target_version_not_null` | n | `NOT NULL target_version` |
| `approvals_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `approvals_timeline_check` | Kiểm tra | `CHECK ((jsonb_typeof(timeline) = 'array'::text))` |
| `approvals_timeline_not_null` | n | `NOT NULL timeline` |
| `approvals_title_not_null` | n | `NOT NULL title` |
| `approvals_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `approvals_actor_idx`: `argolet.approvals USING btree (actor_id)`
- `approvals_entity_idx`: `argolet.approvals USING btree (tenant_id, entity_id)`
- `approvals_status_idx`: `argolet.approvals USING btree (tenant_id, status)`
- `approvals_target_idx`: `argolet.approvals USING btree (tenant_id, target_type, target_id)`

### assets

G3 · Tài sản vận hành và chỉ số đo lường (đường cơ sở / kỳ báo cáo), lịch bảo trì

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `code` | text | có |
| `name` | text | có |
| `kind` | text | có |
| `project_code` | text | có |
| `baseline` | argolet.non_negative |  |
| `reporting` | argolet.non_negative |  |
| `unit` | text | có |
| `schedule` | text | có |
| `due_date` | date |  |
| `status` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `assets_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `assets_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `assets_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `assets_code_not_null` | n | `NOT NULL code` |
| `assets_created_at_not_null` | n | `NOT NULL created_at` |
| `assets_id_not_null` | n | `NOT NULL id` |
| `assets_kind_check` | Kiểm tra | `CHECK ((kind = ANY (ARRAY['ASSET'::text, 'METRIC'::text])))` |
| `assets_kind_not_null` | n | `NOT NULL kind` |
| `assets_name_not_null` | n | `NOT NULL name` |
| `assets_project_code_not_null` | n | `NOT NULL project_code` |
| `assets_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `assets_rev_not_null` | n | `NOT NULL rev` |
| `assets_schedule_not_null` | n | `NOT NULL schedule` |
| `assets_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['MONITORING'::text, 'MAINTENANCE_DUE'::text, 'OK'::text])))` |
| `assets_status_not_null` | n | `NOT NULL status` |
| `assets_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `assets_unit_not_null` | n | `NOT NULL unit` |
| `assets_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `assets_project_idx`: `argolet.assets USING btree (tenant_id, project_code)`

### assistant_conversations

Hội thoại với trợ lý ARGOLET: câu hỏi, trả lời kèm trích dẫn nguồn và đề xuất hành động

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `user_id` | text | có |
| `title` | text | có |
| `messages` | jsonb | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `assistant_conversations_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `assistant_conversations_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `assistant_conversations_user_fk` | Khoá ngoại | `FOREIGN KEY (user_id) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `assistant_conversations_created_at_not_null` | n | `NOT NULL created_at` |
| `assistant_conversations_id_not_null` | n | `NOT NULL id` |
| `assistant_conversations_messages_check` | Kiểm tra | `CHECK ((jsonb_typeof(messages) = 'array'::text))` |
| `assistant_conversations_messages_not_null` | n | `NOT NULL messages` |
| `assistant_conversations_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `assistant_conversations_rev_not_null` | n | `NOT NULL rev` |
| `assistant_conversations_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `assistant_conversations_title_not_null` | n | `NOT NULL title` |
| `assistant_conversations_updated_at_not_null` | n | `NOT NULL updated_at` |
| `assistant_conversations_user_id_not_null` | n | `NOT NULL user_id` |

Chỉ mục:

- `assistant_conversations_user_idx`: `argolet.assistant_conversations USING btree (tenant_id, user_id)`
- `assistant_conversations_user_ref_idx`: `argolet.assistant_conversations USING btree (user_id)`

### audit_log

Nhật ký kiểm toán: ai làm gì, trên đối tượng nào, khi nào (bất biến; giữ lại cả khi người dùng bị xoá)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `actor_id` | text | có |
| `actor_name` | text | có |
| `action` | text | có |
| `target` | text | có |
| `detail` | text | có |
| `correlation_id` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `audit_log_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `audit_log_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `audit_log_action_not_null` | n | `NOT NULL action` |
| `audit_log_actor_id_not_null` | n | `NOT NULL actor_id` |
| `audit_log_actor_name_not_null` | n | `NOT NULL actor_name` |
| `audit_log_correlation_id_not_null` | n | `NOT NULL correlation_id` |
| `audit_log_created_at_not_null` | n | `NOT NULL created_at` |
| `audit_log_detail_not_null` | n | `NOT NULL detail` |
| `audit_log_id_not_null` | n | `NOT NULL id` |
| `audit_log_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `audit_log_rev_not_null` | n | `NOT NULL rev` |
| `audit_log_target_not_null` | n | `NOT NULL target` |
| `audit_log_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `audit_log_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `audit_log_actor_idx`: `argolet.audit_log USING btree (tenant_id, actor_id)`
- `audit_log_correlation_idx`: `argolet.audit_log USING btree (correlation_id)`
- `audit_log_time_idx`: `argolet.audit_log USING btree (tenant_id, created_at)`

Trigger: `audit_log_append_only` (chỉ ghi thêm).

### business_record_history

Các phiên bản cũ của bản ghi nghiệp vụ (bất biến)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `record_id` | text | có |
| `version` | integer | có |
| `entity_id` | text | có |
| `kind` | text | có |
| `code` | text | có |
| `amount` | numeric | có |
| `currency` | argolet.currency_code | có |
| `record_date` | date | có |
| `channel` | text | có |
| `counterparty` | text | có |
| `reference` | text | có |
| `payout_batch` | text | có |
| `description` | text |  |
| `fee` | numeric | có |
| `refund` | numeric | có |
| `discount` | numeric | có |
| `adjustment` | numeric | có |
| `document_id` | text |  |
| `match_group_id` | text |  |
| `period_id` | argolet.period_id | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `business_record_history_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `business_record_history_tenant_id_record_id_version_key` | Duy nhất | `UNIQUE (tenant_id, record_id, version)` |
| `business_record_history_record_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, record_id) REFERENCES argolet.business_records(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `business_record_history_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `business_record_history_adjustment_not_null` | n | `NOT NULL adjustment` |
| `business_record_history_amount_not_null` | n | `NOT NULL amount` |
| `business_record_history_channel_not_null` | n | `NOT NULL channel` |
| `business_record_history_code_not_null` | n | `NOT NULL code` |
| `business_record_history_counterparty_not_null` | n | `NOT NULL counterparty` |
| `business_record_history_created_at_not_null` | n | `NOT NULL created_at` |
| `business_record_history_currency_not_null` | n | `NOT NULL currency` |
| `business_record_history_discount_not_null` | n | `NOT NULL discount` |
| `business_record_history_entity_id_not_null` | n | `NOT NULL entity_id` |
| `business_record_history_fee_not_null` | n | `NOT NULL fee` |
| `business_record_history_id_not_null` | n | `NOT NULL id` |
| `business_record_history_kind_check` | Kiểm tra | `CHECK ((kind = ANY (ARRAY['ORDER'::text, 'BANK_TXN'::text, 'CASH'::text, 'EXPENSE'::text, 'REVENUE'::text])))` |
| `business_record_history_kind_not_null` | n | `NOT NULL kind` |
| `business_record_history_payout_batch_not_null` | n | `NOT NULL payout_batch` |
| `business_record_history_period_id_not_null` | n | `NOT NULL period_id` |
| `business_record_history_record_date_not_null` | n | `NOT NULL record_date` |
| `business_record_history_record_id_not_null` | n | `NOT NULL record_id` |
| `business_record_history_reference_not_null` | n | `NOT NULL reference` |
| `business_record_history_refund_not_null` | n | `NOT NULL refund` |
| `business_record_history_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `business_record_history_rev_not_null` | n | `NOT NULL rev` |
| `business_record_history_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `business_record_history_updated_at_not_null` | n | `NOT NULL updated_at` |
| `business_record_history_version_check` | Kiểm tra | `CHECK ((version >= 1))` |
| `business_record_history_version_not_null` | n | `NOT NULL version` |

Trigger: `business_record_history_append_only` (chỉ ghi thêm).

### business_records

Bản ghi nghiệp vụ hiện hành (đơn hàng, giao dịch ngân hàng, tiền mặt, chi phí, doanh thu) sinh ra từ chứng từ đã xác nhận

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `record_id` | text | có |
| `version` | integer | có |
| `entity_id` | text | có |
| `kind` | text | có |
| `code` | text | có |
| `amount` | numeric | có |
| `currency` | argolet.currency_code | có |
| `record_date` | date | có |
| `channel` | text | có |
| `counterparty` | text | có |
| `reference` | text | có |
| `payout_batch` | text | có |
| `description` | text |  |
| `fee` | numeric | có |
| `refund` | numeric | có |
| `discount` | numeric | có |
| `adjustment` | numeric | có |
| `document_id` | text |  |
| `match_group_id` | text |  |
| `period_id` | argolet.period_id | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `business_records_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `business_records_document_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, document_id) REFERENCES argolet.documents(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `business_records_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `business_records_group_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, match_group_id) REFERENCES argolet.match_groups(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `business_records_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `business_records_adjustment_not_null` | n | `NOT NULL adjustment` |
| `business_records_amount_not_null` | n | `NOT NULL amount` |
| `business_records_channel_not_null` | n | `NOT NULL channel` |
| `business_records_check` | Kiểm tra | `CHECK ((id = record_id))` |
| `business_records_code_not_null` | n | `NOT NULL code` |
| `business_records_counterparty_not_null` | n | `NOT NULL counterparty` |
| `business_records_created_at_not_null` | n | `NOT NULL created_at` |
| `business_records_currency_not_null` | n | `NOT NULL currency` |
| `business_records_discount_not_null` | n | `NOT NULL discount` |
| `business_records_entity_id_not_null` | n | `NOT NULL entity_id` |
| `business_records_fee_not_null` | n | `NOT NULL fee` |
| `business_records_id_not_null` | n | `NOT NULL id` |
| `business_records_kind_check` | Kiểm tra | `CHECK ((kind = ANY (ARRAY['ORDER'::text, 'BANK_TXN'::text, 'CASH'::text, 'EXPENSE'::text, 'REVENUE'::text])))` |
| `business_records_kind_not_null` | n | `NOT NULL kind` |
| `business_records_payout_batch_not_null` | n | `NOT NULL payout_batch` |
| `business_records_period_id_not_null` | n | `NOT NULL period_id` |
| `business_records_record_date_not_null` | n | `NOT NULL record_date` |
| `business_records_record_id_not_null` | n | `NOT NULL record_id` |
| `business_records_reference_not_null` | n | `NOT NULL reference` |
| `business_records_refund_not_null` | n | `NOT NULL refund` |
| `business_records_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `business_records_rev_not_null` | n | `NOT NULL rev` |
| `business_records_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `business_records_updated_at_not_null` | n | `NOT NULL updated_at` |
| `business_records_version_check` | Kiểm tra | `CHECK ((version >= 1))` |
| `business_records_version_not_null` | n | `NOT NULL version` |

Chỉ mục:

- `business_records_document_idx`: `argolet.business_records USING btree (tenant_id, document_id)`
- `business_records_group_idx`: `argolet.business_records USING btree (tenant_id, match_group_id)`
- `business_records_open_idx`: `argolet.business_records USING btree (tenant_id, entity_id, period_id) WHERE (match_group_id IS NULL)`
- `business_records_period_idx`: `argolet.business_records USING btree (tenant_id, entity_id, period_id)`

### calc_runs

Lần tính toán tài chính có thể tái lập: giả định, phương pháp, phiên bản động cơ và kết quả (bất biến)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `calc_run_id` | text | có |
| `task` | text | có |
| `package_code` | text | có |
| `input_snapshot_digest` | argolet.sha256_hex | có |
| `rules_version` | text | có |
| `engine_version` | text | có |
| `assumptions` | jsonb |  |
| `method` | text | có |
| `result` | jsonb |  |
| `created_by` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `calc_runs_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `calc_runs_created_by_fk` | Khoá ngoại | `FOREIGN KEY (created_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `calc_runs_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `calc_runs_calc_run_id_not_null` | n | `NOT NULL calc_run_id` |
| `calc_runs_check` | Kiểm tra | `CHECK ((calc_run_id = id))` |
| `calc_runs_created_at_not_null` | n | `NOT NULL created_at` |
| `calc_runs_created_by_not_null` | n | `NOT NULL created_by` |
| `calc_runs_engine_version_not_null` | n | `NOT NULL engine_version` |
| `calc_runs_id_not_null` | n | `NOT NULL id` |
| `calc_runs_input_snapshot_digest_not_null` | n | `NOT NULL input_snapshot_digest` |
| `calc_runs_method_not_null` | n | `NOT NULL method` |
| `calc_runs_package_code_check` | Kiểm tra | `CHECK ((package_code = ANY (ARRAY['G1'::text, 'G2'::text, 'G3'::text, 'G4'::text])))` |
| `calc_runs_package_code_not_null` | n | `NOT NULL package_code` |
| `calc_runs_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `calc_runs_rev_not_null` | n | `NOT NULL rev` |
| `calc_runs_rules_version_not_null` | n | `NOT NULL rules_version` |
| `calc_runs_task_not_null` | n | `NOT NULL task` |
| `calc_runs_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `calc_runs_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `calc_runs_created_by_idx`: `argolet.calc_runs USING btree (created_by)`

Trigger: `calc_runs_append_only` (chỉ ghi thêm).

### clients

G2 · Khách hàng dịch vụ kế toán: tiến độ hồ sơ, hạn chốt, uỷ quyền

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `name` | text | có |
| `scope` | text | có |
| `completion` | integer | có |
| `close_due` | date | có |
| `status` | text | có |
| `missing_docs` | integer | có |
| `delegation_valid_until` | date | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `clients_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `clients_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `clients_close_due_not_null` | n | `NOT NULL close_due` |
| `clients_completion_check` | Kiểm tra | `CHECK (((completion >= 0) AND (completion <= 100)))` |
| `clients_completion_not_null` | n | `NOT NULL completion` |
| `clients_created_at_not_null` | n | `NOT NULL created_at` |
| `clients_delegation_valid_until_not_null` | n | `NOT NULL delegation_valid_until` |
| `clients_id_not_null` | n | `NOT NULL id` |
| `clients_missing_docs_check` | Kiểm tra | `CHECK ((missing_docs >= 0))` |
| `clients_missing_docs_not_null` | n | `NOT NULL missing_docs` |
| `clients_name_not_null` | n | `NOT NULL name` |
| `clients_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `clients_rev_not_null` | n | `NOT NULL rev` |
| `clients_scope_not_null` | n | `NOT NULL scope` |
| `clients_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['MISSING_DOCS'::text, 'READY'::text, 'REVIEWED'::text, 'WAITING'::text])))` |
| `clients_status_not_null` | n | `NOT NULL status` |
| `clients_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `clients_updated_at_not_null` | n | `NOT NULL updated_at` |

### close_snapshots

Ảnh chụp chốt kỳ (bất biến trừ trạng thái neo bằng chứng): manifest các bản ghi, nguồn, phê duyệt và tổng số; digest được neo

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `entity_id` | text | có |
| `period_id` | argolet.period_id | có |
| `version` | integer | có |
| `previous_close_id` | text |  |
| `rules_version` | text | có |
| `manifest` | jsonb | có |
| `manifest_digest` | argolet.sha256_hex | có |
| `approval_ids` | text[] | có |
| `closed_by` | text | có |
| `closed_at` | timestamp with time zone | có |
| `evidence_status` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `close_snapshots_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `close_snapshots_tenant_id_entity_id_period_id_version_key` | Duy nhất | `UNIQUE (tenant_id, entity_id, period_id, version)` |
| `close_snapshots_closed_by_fk` | Khoá ngoại | `FOREIGN KEY (closed_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `close_snapshots_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `close_snapshots_previous_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, previous_close_id) REFERENCES argolet.close_snapshots(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `close_snapshots_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `close_snapshots_approval_ids_not_null` | n | `NOT NULL approval_ids` |
| `close_snapshots_check` | Kiểm tra | `CHECK (((previous_close_id IS NULL) OR (previous_close_id <> id)))` |
| `close_snapshots_closed_at_not_null` | n | `NOT NULL closed_at` |
| `close_snapshots_closed_by_not_null` | n | `NOT NULL closed_by` |
| `close_snapshots_created_at_not_null` | n | `NOT NULL created_at` |
| `close_snapshots_entity_id_not_null` | n | `NOT NULL entity_id` |
| `close_snapshots_evidence_status_check` | Kiểm tra | `CHECK ((evidence_status = ANY (ARRAY['PENDING'::text, 'ANCHORED'::text, 'FAILED'::text])))` |
| `close_snapshots_evidence_status_not_null` | n | `NOT NULL evidence_status` |
| `close_snapshots_id_not_null` | n | `NOT NULL id` |
| `close_snapshots_manifest_check` | Kiểm tra | `CHECK ((jsonb_typeof(manifest) = 'object'::text))` |
| `close_snapshots_manifest_digest_not_null` | n | `NOT NULL manifest_digest` |
| `close_snapshots_manifest_not_null` | n | `NOT NULL manifest` |
| `close_snapshots_period_id_not_null` | n | `NOT NULL period_id` |
| `close_snapshots_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `close_snapshots_rev_not_null` | n | `NOT NULL rev` |
| `close_snapshots_rules_version_not_null` | n | `NOT NULL rules_version` |
| `close_snapshots_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `close_snapshots_updated_at_not_null` | n | `NOT NULL updated_at` |
| `close_snapshots_version_check` | Kiểm tra | `CHECK ((version >= 1))` |
| `close_snapshots_version_not_null` | n | `NOT NULL version` |

Chỉ mục:

- `close_snapshots_closed_by_idx`: `argolet.close_snapshots USING btree (closed_by)`
- `close_snapshots_previous_idx`: `argolet.close_snapshots USING btree (tenant_id, previous_close_id)`

Trigger: `close_snapshots_append_only` (chỉ ghi thêm).

### connection_runs

Nhật ký từng lần kiểm tra / đồng bộ với đối tác: số bản ghi nhận, chứng từ tạo ra, lỗi (chỉ ghi thêm)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `connection_id` | text | có |
| `provider` | text | có |
| `trigger` | text | có |
| `started_at` | timestamp with time zone | có |
| `finished_at` | timestamp with time zone | có |
| `status` | text | có |
| `fetched` | integer | có |
| `imported` | integer | có |
| `requests` | integer | có |
| `document_id` | text |  |
| `document_code` | text |  |
| `message` | text | có |
| `actor_id` | text | có |
| `actor_name` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `connection_runs_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `connection_runs_actor_fk` | Khoá ngoại | `FOREIGN KEY (actor_id) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `connection_runs_connection_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, connection_id) REFERENCES argolet.connections(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `connection_runs_document_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, document_id) REFERENCES argolet.documents(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `connection_runs_actor_id_not_null` | n | `NOT NULL actor_id` |
| `connection_runs_actor_name_not_null` | n | `NOT NULL actor_name` |
| `connection_runs_check` | Kiểm tra | `CHECK ((finished_at >= started_at))` |
| `connection_runs_check1` | Kiểm tra | `CHECK (((document_id IS NULL) = (document_code IS NULL)))` |
| `connection_runs_connection_id_not_null` | n | `NOT NULL connection_id` |
| `connection_runs_created_at_not_null` | n | `NOT NULL created_at` |
| `connection_runs_fetched_check` | Kiểm tra | `CHECK ((fetched >= 0))` |
| `connection_runs_fetched_not_null` | n | `NOT NULL fetched` |
| `connection_runs_finished_at_not_null` | n | `NOT NULL finished_at` |
| `connection_runs_id_not_null` | n | `NOT NULL id` |
| `connection_runs_imported_check` | Kiểm tra | `CHECK ((imported >= 0))` |
| `connection_runs_imported_not_null` | n | `NOT NULL imported` |
| `connection_runs_message_not_null` | n | `NOT NULL message` |
| `connection_runs_provider_check` | Kiểm tra | `CHECK ((provider = ANY (ARRAY['SEPAY'::text, 'KIOTVIET'::text])))` |
| `connection_runs_provider_not_null` | n | `NOT NULL provider` |
| `connection_runs_requests_check` | Kiểm tra | `CHECK ((requests >= 0))` |
| `connection_runs_requests_not_null` | n | `NOT NULL requests` |
| `connection_runs_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `connection_runs_rev_not_null` | n | `NOT NULL rev` |
| `connection_runs_started_at_not_null` | n | `NOT NULL started_at` |
| `connection_runs_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['SUCCESS'::text, 'NO_CHANGE'::text, 'FAILED'::text])))` |
| `connection_runs_status_not_null` | n | `NOT NULL status` |
| `connection_runs_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `connection_runs_trigger_check` | Kiểm tra | `CHECK ((trigger = ANY (ARRAY['MANUAL'::text, 'SCHEDULE'::text, 'TEST'::text])))` |
| `connection_runs_trigger_not_null` | n | `NOT NULL trigger` |
| `connection_runs_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `connection_runs_actor_idx`: `argolet.connection_runs USING btree (actor_id)`
- `connection_runs_connection_idx`: `argolet.connection_runs USING btree (tenant_id, connection_id, started_at DESC)`
- `connection_runs_document_idx`: `argolet.connection_runs USING btree (tenant_id, document_id)`

Trigger: `connection_runs_append_only` (chỉ ghi thêm).

### connections

Kết nối từ ARGOLET tới API của đối tác (ngân hàng qua SePay, POS qua KiotViet…); khóa truy cập được mã hóa AES-256-GCM bằng khóa máy chủ

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `provider` | text | có |
| `label` | text | có |
| `status` | text | có |
| `config` | jsonb | có |
| `secret_sealed` | text |  |
| `secret_hint` | text | có |
| `cursor` | text |  |
| `entity_id` | text | có |
| `connected_by` | text | có |
| `connected_by_name` | text | có |
| `connected_at` | timestamp with time zone | có |
| `last_sync_at` | timestamp with time zone |  |
| `last_error` | text |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `connections_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `connections_connected_by_fk` | Khoá ngoại | `FOREIGN KEY (connected_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `connections_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `connections_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `connections_check` | Kiểm tra | `CHECK (((status = 'DISCONNECTED'::text) OR (secret_sealed IS NOT NULL)))` |
| `connections_config_check` | Kiểm tra | `CHECK ((jsonb_typeof(config) = 'object'::text))` |
| `connections_config_not_null` | n | `NOT NULL config` |
| `connections_connected_at_not_null` | n | `NOT NULL connected_at` |
| `connections_connected_by_name_not_null` | n | `NOT NULL connected_by_name` |
| `connections_connected_by_not_null` | n | `NOT NULL connected_by` |
| `connections_created_at_not_null` | n | `NOT NULL created_at` |
| `connections_entity_id_not_null` | n | `NOT NULL entity_id` |
| `connections_id_not_null` | n | `NOT NULL id` |
| `connections_label_check` | Kiểm tra | `CHECK ((btrim(label) <> ''::text))` |
| `connections_label_not_null` | n | `NOT NULL label` |
| `connections_provider_check` | Kiểm tra | `CHECK ((provider = ANY (ARRAY['SEPAY'::text, 'KIOTVIET'::text])))` |
| `connections_provider_not_null` | n | `NOT NULL provider` |
| `connections_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `connections_rev_not_null` | n | `NOT NULL rev` |
| `connections_secret_hint_not_null` | n | `NOT NULL secret_hint` |
| `connections_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'ERROR'::text, 'DISCONNECTED'::text])))` |
| `connections_status_not_null` | n | `NOT NULL status` |
| `connections_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `connections_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `connections_connected_by_idx`: `argolet.connections USING btree (connected_by)`
- `connections_entity_idx`: `argolet.connections USING btree (tenant_id, entity_id)`

### credentials

Mật khẩu đã băm (Argon2id / scrypt) – tách khỏi bảng người dùng

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `id` | text | có |
| `user_id` | text | có |
| `password_hash` | text | có |
| `password_updated_at` | timestamp with time zone | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `credentials_pkey` | Khoá chính | `PRIMARY KEY (id)` |
| `credentials_user_id_key` | Duy nhất | `UNIQUE (user_id)` |
| `credentials_user_fk` | Khoá ngoại | `FOREIGN KEY (user_id) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `credentials_created_at_not_null` | n | `NOT NULL created_at` |
| `credentials_id_not_null` | n | `NOT NULL id` |
| `credentials_password_hash_check` | Kiểm tra | `CHECK ((password_hash <> ''::text))` |
| `credentials_password_hash_not_null` | n | `NOT NULL password_hash` |
| `credentials_password_updated_at_not_null` | n | `NOT NULL password_updated_at` |
| `credentials_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `credentials_rev_not_null` | n | `NOT NULL rev` |
| `credentials_updated_at_not_null` | n | `NOT NULL updated_at` |
| `credentials_user_id_not_null` | n | `NOT NULL user_id` |

### daily_closes

G1 · Chốt ca / chốt ngày: số hệ thống và số thực kiểm theo kênh thu

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `entity_id` | text | có |
| `business_date` | date | có |
| `shift` | text | có |
| `lines` | jsonb | có |
| `status` | text | có |
| `submitted_by` | text |  |
| `submitted_at` | timestamp with time zone |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `daily_closes_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `daily_closes_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `daily_closes_submitted_by_fk` | Khoá ngoại | `FOREIGN KEY (submitted_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `daily_closes_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `daily_closes_business_date_not_null` | n | `NOT NULL business_date` |
| `daily_closes_check` | Kiểm tra | `CHECK (((status = 'OPEN'::text) OR ((submitted_by IS NOT NULL) AND (submitted_at IS NOT NULL))))` |
| `daily_closes_created_at_not_null` | n | `NOT NULL created_at` |
| `daily_closes_entity_id_not_null` | n | `NOT NULL entity_id` |
| `daily_closes_id_not_null` | n | `NOT NULL id` |
| `daily_closes_lines_check` | Kiểm tra | `CHECK ((jsonb_typeof(lines) = 'array'::text))` |
| `daily_closes_lines_not_null` | n | `NOT NULL lines` |
| `daily_closes_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `daily_closes_rev_not_null` | n | `NOT NULL rev` |
| `daily_closes_shift_not_null` | n | `NOT NULL shift` |
| `daily_closes_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['OPEN'::text, 'SUBMITTED'::text])))` |
| `daily_closes_status_not_null` | n | `NOT NULL status` |
| `daily_closes_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `daily_closes_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `daily_closes_entity_idx`: `argolet.daily_closes USING btree (tenant_id, entity_id, business_date)`
- `daily_closes_submitted_by_idx`: `argolet.daily_closes USING btree (submitted_by)`

### deals

G2 · Cơ hội / hợp đồng bán hàng theo giai đoạn: cơ hội → báo giá → hợp đồng → giao → hoá đơn → thu tiền

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `code` | text | có |
| `customer` | text | có |
| `stage` | text | có |
| `deal_value` | numeric | có |
| `status` | text | có |
| `due_date` | date | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `deals_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `deals_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `deals_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `deals_code_not_null` | n | `NOT NULL code` |
| `deals_created_at_not_null` | n | `NOT NULL created_at` |
| `deals_customer_not_null` | n | `NOT NULL customer` |
| `deals_deal_value_not_null` | n | `NOT NULL deal_value` |
| `deals_due_date_not_null` | n | `NOT NULL due_date` |
| `deals_id_not_null` | n | `NOT NULL id` |
| `deals_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `deals_rev_not_null` | n | `NOT NULL rev` |
| `deals_stage_check` | Kiểm tra | `CHECK ((stage = ANY (ARRAY['OPPORTUNITY'::text, 'QUOTE'::text, 'CONTRACT'::text, 'DELIVERY'::text, 'INVOICE'::text, 'COLLECTION'::text])))` |
| `deals_stage_not_null` | n | `NOT NULL stage` |
| `deals_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['WAITING_REPLY'::text, 'IN_PROGRESS'::text, 'DUE'::text, 'DONE'::text])))` |
| `deals_status_not_null` | n | `NOT NULL status` |
| `deals_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `deals_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `deals_stage_idx`: `argolet.deals USING btree (tenant_id, stage)`

### document_versions

Phiên bản đã xác nhận của chứng từ (bất biến): trường dữ liệu, người xác nhận, dấu vân tay có muối để neo bằng chứng

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `document_id` | text | có |
| `version` | integer | có |
| `artifact_id` | text |  |
| `parser_version` | text | có |
| `fields` | jsonb | có |
| `field_locator` | text | có |
| `confirmed_by` | text | có |
| `confirmed_by_name` | text | có |
| `confirmed_at` | timestamp with time zone | có |
| `note` | text | có |
| `fingerprint` | argolet.sha256_hex | có |
| `salt` | argolet.hex_text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `document_versions_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `document_versions_tenant_id_document_id_version_key` | Duy nhất | `UNIQUE (tenant_id, document_id, version)` |
| `document_versions_artifact_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, artifact_id) REFERENCES argolet.source_artifacts(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `document_versions_confirmed_by_fk` | Khoá ngoại | `FOREIGN KEY (confirmed_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `document_versions_document_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, document_id) REFERENCES argolet.documents(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `document_versions_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `document_versions_confirmed_at_not_null` | n | `NOT NULL confirmed_at` |
| `document_versions_confirmed_by_name_not_null` | n | `NOT NULL confirmed_by_name` |
| `document_versions_confirmed_by_not_null` | n | `NOT NULL confirmed_by` |
| `document_versions_created_at_not_null` | n | `NOT NULL created_at` |
| `document_versions_document_id_not_null` | n | `NOT NULL document_id` |
| `document_versions_field_locator_not_null` | n | `NOT NULL field_locator` |
| `document_versions_fields_check` | Kiểm tra | `CHECK ((jsonb_typeof(fields) = 'object'::text))` |
| `document_versions_fields_not_null` | n | `NOT NULL fields` |
| `document_versions_fingerprint_not_null` | n | `NOT NULL fingerprint` |
| `document_versions_id_not_null` | n | `NOT NULL id` |
| `document_versions_note_not_null` | n | `NOT NULL note` |
| `document_versions_parser_version_not_null` | n | `NOT NULL parser_version` |
| `document_versions_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `document_versions_rev_not_null` | n | `NOT NULL rev` |
| `document_versions_salt_not_null` | n | `NOT NULL salt` |
| `document_versions_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `document_versions_updated_at_not_null` | n | `NOT NULL updated_at` |
| `document_versions_version_check` | Kiểm tra | `CHECK ((version >= 1))` |
| `document_versions_version_not_null` | n | `NOT NULL version` |

Chỉ mục:

- `document_versions_artifact_idx`: `argolet.document_versions USING btree (tenant_id, artifact_id)`
- `document_versions_confirmed_by_idx`: `argolet.document_versions USING btree (confirmed_by)`

Trigger: `document_versions_append_only` (chỉ ghi thêm).

### documents

Chứng từ: hoá đơn, sao kê, báo cáo POS / nền tảng, phiếu giao… với trường đã trích xuất, dòng chi tiết và vấn đề cần kiểm tra

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `code` | text | có |
| `title` | text | có |
| `counterparty` | text | có |
| `source_kind` | text | có |
| `entity_id` | text | có |
| `document_date` | date | có |
| `amount` | numeric | có |
| `status` | text | có |
| `current_version` | integer | có |
| `artifact_id` | text |  |
| `batch_id` | text |  |
| `fields` | jsonb | có |
| `lines` | jsonb | có |
| `vat` | argolet.non_negative |  |
| `structured_rows` | jsonb | có |
| `row_kind` | text |  |
| `extraction` | jsonb |  |
| `issues` | jsonb | có |
| `received_at` | timestamp with time zone | có |
| `received_by` | text | có |
| `validated_by` | text |  |
| `validated_at` | timestamp with time zone |  |
| `kind` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `documents_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `documents_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `documents_artifact_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, artifact_id) REFERENCES argolet.source_artifacts(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `documents_batch_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, batch_id) REFERENCES argolet.import_batches(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `documents_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `documents_received_by_fk` | Khoá ngoại | `FOREIGN KEY (received_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `documents_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `documents_validated_by_fk` | Khoá ngoại | `FOREIGN KEY (validated_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `documents_amount_not_null` | n | `NOT NULL amount` |
| `documents_check` | Kiểm tra | `CHECK (((validated_by IS NULL) = (validated_at IS NULL)))` |
| `documents_code_not_null` | n | `NOT NULL code` |
| `documents_counterparty_not_null` | n | `NOT NULL counterparty` |
| `documents_created_at_not_null` | n | `NOT NULL created_at` |
| `documents_current_version_check` | Kiểm tra | `CHECK ((current_version >= 0))` |
| `documents_current_version_not_null` | n | `NOT NULL current_version` |
| `documents_document_date_not_null` | n | `NOT NULL document_date` |
| `documents_entity_id_not_null` | n | `NOT NULL entity_id` |
| `documents_extraction_check` | Kiểm tra | `CHECK ((jsonb_typeof(extraction) = 'object'::text))` |
| `documents_fields_check` | Kiểm tra | `CHECK ((jsonb_typeof(fields) = 'object'::text))` |
| `documents_fields_not_null` | n | `NOT NULL fields` |
| `documents_id_not_null` | n | `NOT NULL id` |
| `documents_issues_check` | Kiểm tra | `CHECK ((jsonb_typeof(issues) = 'array'::text))` |
| `documents_issues_not_null` | n | `NOT NULL issues` |
| `documents_kind_check` | Kiểm tra | `CHECK ((kind = ANY (ARRAY['EXPENSE'::text, 'REVENUE'::text, 'STATEMENT'::text, 'OTHER'::text])))` |
| `documents_kind_not_null` | n | `NOT NULL kind` |
| `documents_lines_check` | Kiểm tra | `CHECK ((jsonb_typeof(lines) = 'array'::text))` |
| `documents_lines_not_null` | n | `NOT NULL lines` |
| `documents_received_at_not_null` | n | `NOT NULL received_at` |
| `documents_received_by_not_null` | n | `NOT NULL received_by` |
| `documents_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `documents_rev_not_null` | n | `NOT NULL rev` |
| `documents_row_kind_check` | Kiểm tra | `CHECK ((row_kind = ANY (ARRAY['BANK'::text, 'POS'::text])))` |
| `documents_source_kind_check` | Kiểm tra | `CHECK ((source_kind = ANY (ARRAY['PHOTO'::text, 'XML_EINVOICE'::text, 'BANK'::text, 'CSV'::text, 'PDF'::text, 'POS'::text, 'EXCEL'::text])))` |
| `documents_source_kind_not_null` | n | `NOT NULL source_kind` |
| `documents_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['RECEIVED'::text, 'EXTRACTED'::text, 'NEEDS_REVIEW'::text, 'VALIDATED'::text, 'REJECTED'::text, 'NEEDS_RECON'::text])))` |
| `documents_status_not_null` | n | `NOT NULL status` |
| `documents_structured_rows_check` | Kiểm tra | `CHECK ((jsonb_typeof(structured_rows) = 'array'::text))` |
| `documents_structured_rows_not_null` | n | `NOT NULL structured_rows` |
| `documents_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `documents_title_not_null` | n | `NOT NULL title` |
| `documents_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `documents_artifact_idx`: `argolet.documents USING btree (tenant_id, artifact_id)`
- `documents_batch_idx`: `argolet.documents USING btree (tenant_id, batch_id)`
- `documents_created_idx`: `argolet.documents USING btree (tenant_id, created_at)`
- `documents_entity_idx`: `argolet.documents USING btree (tenant_id, entity_id, document_date)`
- `documents_received_by_idx`: `argolet.documents USING btree (received_by)`
- `documents_status_idx`: `argolet.documents USING btree (tenant_id, status)`
- `documents_validated_by_idx`: `argolet.documents USING btree (validated_by)`

### event_inbox

Hộp thư đến của từng bộ xử lý sự kiện: bảo đảm mỗi sự kiện chỉ được xử lý một lần (bất biến)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `consumer` | text | có |
| `event_id` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `event_inbox_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `event_inbox_tenant_id_consumer_event_id_key` | Duy nhất | `UNIQUE (tenant_id, consumer, event_id)` |
| `event_inbox_check` | Kiểm tra | `CHECK ((id = ((consumer \|\| ':'::text) \|\| event_id)))` |
| `event_inbox_consumer_not_null` | n | `NOT NULL consumer` |
| `event_inbox_created_at_not_null` | n | `NOT NULL created_at` |
| `event_inbox_event_id_not_null` | n | `NOT NULL event_id` |
| `event_inbox_id_not_null` | n | `NOT NULL id` |
| `event_inbox_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `event_inbox_rev_not_null` | n | `NOT NULL rev` |
| `event_inbox_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `event_inbox_updated_at_not_null` | n | `NOT NULL updated_at` |

Trigger: `event_inbox_append_only` (chỉ ghi thêm).

### event_outbox

Hộp thư đi của sự kiện miền (DomainEvent), ghi cùng giao dịch với dữ liệu; published_at = đã phát

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `event` | jsonb | có |
| `published_at` | timestamp with time zone |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `event_outbox_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `event_outbox_check` | Kiểm tra | `CHECK (((event ->> 'eventId'::text) = id))` |
| `event_outbox_created_at_not_null` | n | `NOT NULL created_at` |
| `event_outbox_event_check` | Kiểm tra | `CHECK ((jsonb_typeof(event) = 'object'::text))` |
| `event_outbox_event_not_null` | n | `NOT NULL event` |
| `event_outbox_id_not_null` | n | `NOT NULL id` |
| `event_outbox_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `event_outbox_rev_not_null` | n | `NOT NULL rev` |
| `event_outbox_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `event_outbox_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `event_outbox_pending_idx`: `argolet.event_outbox USING btree (created_at) WHERE (published_at IS NULL)`

### evidence_batches

Lô bằng chứng: cây Merkle trên các lá có muối (xem v_evidence_leaves) và biên nhận neo vào sổ cái

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `code` | text | có |
| `batch_ref` | argolet.hex_text | có |
| `merkle_root` | argolet.sha256_hex | có |
| `schema_version` | text | có |
| `leaves` | jsonb | có |
| `receipt` | jsonb |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `evidence_batches_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `evidence_batches_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `evidence_batches_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `evidence_batches_batch_ref_not_null` | n | `NOT NULL batch_ref` |
| `evidence_batches_code_not_null` | n | `NOT NULL code` |
| `evidence_batches_created_at_not_null` | n | `NOT NULL created_at` |
| `evidence_batches_id_not_null` | n | `NOT NULL id` |
| `evidence_batches_leaves_check` | Kiểm tra | `CHECK ((jsonb_typeof(leaves) = 'array'::text))` |
| `evidence_batches_leaves_not_null` | n | `NOT NULL leaves` |
| `evidence_batches_merkle_root_not_null` | n | `NOT NULL merkle_root` |
| `evidence_batches_receipt_check` | Kiểm tra | `CHECK ((jsonb_typeof(receipt) = 'object'::text))` |
| `evidence_batches_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `evidence_batches_rev_not_null` | n | `NOT NULL rev` |
| `evidence_batches_schema_version_not_null` | n | `NOT NULL schema_version` |
| `evidence_batches_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `evidence_batches_updated_at_not_null` | n | `NOT NULL updated_at` |

Trigger: `evidence_batches_append_only` (chỉ ghi thêm).

### evidence_receipts

Biên nhận bằng chứng của từng đối tượng (chốt kỳ / phiên bản chứng từ): lô, gốc Merkle, giao dịch và khối trên sổ cái (bất biến)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `target_type` | text | có |
| `target_id` | text | có |
| `target_version` | integer | có |
| `batch_id` | text | có |
| `batch_code` | text | có |
| `merkle_root` | argolet.sha256_hex | có |
| `leaf_index` | integer | có |
| `transaction_id` | argolet.hex_text | có |
| `block_number` | bigint | có |
| `channel` | text | có |
| `validation_code` | text | có |
| `committed_at` | timestamp with time zone | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `evidence_receipts_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `evidence_receipts_tenant_id_target_type_target_id_target_ve_key` | Duy nhất | `UNIQUE (tenant_id, target_type, target_id, target_version)` |
| `evidence_receipts_batch_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, batch_id) REFERENCES argolet.evidence_batches(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `evidence_receipts_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `evidence_receipts_batch_code_not_null` | n | `NOT NULL batch_code` |
| `evidence_receipts_batch_id_not_null` | n | `NOT NULL batch_id` |
| `evidence_receipts_block_number_check` | Kiểm tra | `CHECK ((block_number >= 0))` |
| `evidence_receipts_block_number_not_null` | n | `NOT NULL block_number` |
| `evidence_receipts_channel_not_null` | n | `NOT NULL channel` |
| `evidence_receipts_committed_at_not_null` | n | `NOT NULL committed_at` |
| `evidence_receipts_created_at_not_null` | n | `NOT NULL created_at` |
| `evidence_receipts_id_not_null` | n | `NOT NULL id` |
| `evidence_receipts_leaf_index_check` | Kiểm tra | `CHECK ((leaf_index >= 0))` |
| `evidence_receipts_leaf_index_not_null` | n | `NOT NULL leaf_index` |
| `evidence_receipts_merkle_root_not_null` | n | `NOT NULL merkle_root` |
| `evidence_receipts_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `evidence_receipts_rev_not_null` | n | `NOT NULL rev` |
| `evidence_receipts_target_id_not_null` | n | `NOT NULL target_id` |
| `evidence_receipts_target_type_check` | Kiểm tra | `CHECK ((target_type = ANY (ARRAY['CLOSE'::text, 'DOCUMENT_VERSION'::text])))` |
| `evidence_receipts_target_type_not_null` | n | `NOT NULL target_type` |
| `evidence_receipts_target_version_check` | Kiểm tra | `CHECK ((target_version >= 1))` |
| `evidence_receipts_target_version_not_null` | n | `NOT NULL target_version` |
| `evidence_receipts_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `evidence_receipts_transaction_id_not_null` | n | `NOT NULL transaction_id` |
| `evidence_receipts_updated_at_not_null` | n | `NOT NULL updated_at` |
| `evidence_receipts_validation_code_not_null` | n | `NOT NULL validation_code` |

Chỉ mục:

- `evidence_receipts_batch_idx`: `argolet.evidence_receipts USING btree (tenant_id, batch_id)`

Trigger: `evidence_receipts_append_only` (chỉ ghi thêm).

### evidence_verifications

Nhật ký kiểm tra toàn vẹn: từng bước kiểm tra và kết quả (bất biến)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `target_type` | text | có |
| `target_id` | text | có |
| `ok` | boolean | có |
| `steps` | jsonb | có |
| `requested_by` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `evidence_verifications_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `evidence_verifications_requested_by_fk` | Khoá ngoại | `FOREIGN KEY (requested_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `evidence_verifications_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `evidence_verifications_created_at_not_null` | n | `NOT NULL created_at` |
| `evidence_verifications_id_not_null` | n | `NOT NULL id` |
| `evidence_verifications_ok_not_null` | n | `NOT NULL ok` |
| `evidence_verifications_requested_by_not_null` | n | `NOT NULL requested_by` |
| `evidence_verifications_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `evidence_verifications_rev_not_null` | n | `NOT NULL rev` |
| `evidence_verifications_steps_check` | Kiểm tra | `CHECK ((jsonb_typeof(steps) = 'array'::text))` |
| `evidence_verifications_steps_not_null` | n | `NOT NULL steps` |
| `evidence_verifications_target_id_not_null` | n | `NOT NULL target_id` |
| `evidence_verifications_target_type_check` | Kiểm tra | `CHECK ((target_type = ANY (ARRAY['CLOSE'::text, 'DOCUMENT_VERSION'::text])))` |
| `evidence_verifications_target_type_not_null` | n | `NOT NULL target_type` |
| `evidence_verifications_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `evidence_verifications_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `evidence_verifications_requested_by_idx`: `argolet.evidence_verifications USING btree (requested_by)`
- `evidence_verifications_target_idx`: `argolet.evidence_verifications USING btree (tenant_id, target_type, target_id)`

Trigger: `evidence_verifications_append_only` (chỉ ghi thêm).

### finance_projects

Dự án thẩm định tài chính (NPV / IRR / hoàn vốn) và các kịch bản

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `code` | text | có |
| `name` | text | có |
| `assumptions` | jsonb | có |
| `scenarios` | jsonb | có |
| `last_calc_run_id` | text |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `finance_projects_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `finance_projects_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `finance_projects_calc_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, last_calc_run_id) REFERENCES argolet.calc_runs(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `finance_projects_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `finance_projects_assumptions_check` | Kiểm tra | `CHECK ((jsonb_typeof(assumptions) = 'object'::text))` |
| `finance_projects_assumptions_not_null` | n | `NOT NULL assumptions` |
| `finance_projects_code_not_null` | n | `NOT NULL code` |
| `finance_projects_created_at_not_null` | n | `NOT NULL created_at` |
| `finance_projects_id_not_null` | n | `NOT NULL id` |
| `finance_projects_name_not_null` | n | `NOT NULL name` |
| `finance_projects_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `finance_projects_rev_not_null` | n | `NOT NULL rev` |
| `finance_projects_scenarios_check` | Kiểm tra | `CHECK ((jsonb_typeof(scenarios) = 'array'::text))` |
| `finance_projects_scenarios_not_null` | n | `NOT NULL scenarios` |
| `finance_projects_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `finance_projects_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `finance_projects_calc_idx`: `argolet.finance_projects USING btree (tenant_id, last_calc_run_id)`

### group_entities

G4 · Tình trạng nộp hồ sơ kỳ của từng pháp nhân trong tập đoàn

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `entity_id` | text | có |
| `name` | text | có |
| `code` | text | có |
| `docs_submitted` | integer | có |
| `docs_total` | integer | có |
| `period_status` | text | có |
| `ic_status` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `group_entities_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `group_entities_tenant_id_entity_id_key` | Duy nhất | `UNIQUE (tenant_id, entity_id)` |
| `group_entities_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `group_entities_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `group_entities_check` | Kiểm tra | `CHECK ((docs_submitted <= docs_total))` |
| `group_entities_code_not_null` | n | `NOT NULL code` |
| `group_entities_created_at_not_null` | n | `NOT NULL created_at` |
| `group_entities_docs_submitted_check` | Kiểm tra | `CHECK ((docs_submitted >= 0))` |
| `group_entities_docs_submitted_not_null` | n | `NOT NULL docs_submitted` |
| `group_entities_docs_total_check` | Kiểm tra | `CHECK ((docs_total >= 0))` |
| `group_entities_docs_total_not_null` | n | `NOT NULL docs_total` |
| `group_entities_entity_id_not_null` | n | `NOT NULL entity_id` |
| `group_entities_ic_status_not_null` | n | `NOT NULL ic_status` |
| `group_entities_id_not_null` | n | `NOT NULL id` |
| `group_entities_name_not_null` | n | `NOT NULL name` |
| `group_entities_period_status_check` | Kiểm tra | `CHECK ((period_status = ANY (ARRAY['SUBMITTED'::text, 'PENDING'::text])))` |
| `group_entities_period_status_not_null` | n | `NOT NULL period_status` |
| `group_entities_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `group_entities_rev_not_null` | n | `NOT NULL rev` |
| `group_entities_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `group_entities_updated_at_not_null` | n | `NOT NULL updated_at` |

### import_batches

Lô tiếp nhận chứng từ (một lần tải lên / nhận tệp) và kết quả chuẩn hoá

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `code` | text | có |
| `entity_id` | text | có |
| `source_kind` | text | có |
| `location` | text | có |
| `status` | text | có |
| `file_count` | integer | có |
| `normalized` | integer | có |
| `needs_review` | integer | có |
| `duplicates` | integer | có |
| `created_by` | text | có |
| `parser_version` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `import_batches_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `import_batches_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `import_batches_created_by_fk` | Khoá ngoại | `FOREIGN KEY (created_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `import_batches_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `import_batches_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `import_batches_code_not_null` | n | `NOT NULL code` |
| `import_batches_created_at_not_null` | n | `NOT NULL created_at` |
| `import_batches_created_by_not_null` | n | `NOT NULL created_by` |
| `import_batches_duplicates_check` | Kiểm tra | `CHECK ((duplicates >= 0))` |
| `import_batches_duplicates_not_null` | n | `NOT NULL duplicates` |
| `import_batches_entity_id_not_null` | n | `NOT NULL entity_id` |
| `import_batches_file_count_check` | Kiểm tra | `CHECK ((file_count >= 0))` |
| `import_batches_file_count_not_null` | n | `NOT NULL file_count` |
| `import_batches_id_not_null` | n | `NOT NULL id` |
| `import_batches_location_not_null` | n | `NOT NULL location` |
| `import_batches_needs_review_check` | Kiểm tra | `CHECK ((needs_review >= 0))` |
| `import_batches_needs_review_not_null` | n | `NOT NULL needs_review` |
| `import_batches_normalized_check` | Kiểm tra | `CHECK ((normalized >= 0))` |
| `import_batches_normalized_not_null` | n | `NOT NULL normalized` |
| `import_batches_parser_version_not_null` | n | `NOT NULL parser_version` |
| `import_batches_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `import_batches_rev_not_null` | n | `NOT NULL rev` |
| `import_batches_source_kind_check` | Kiểm tra | `CHECK ((source_kind = ANY (ARRAY['PHOTO'::text, 'XML_EINVOICE'::text, 'BANK'::text, 'CSV'::text, 'PDF'::text, 'POS'::text, 'EXCEL'::text, 'MIXED'::text])))` |
| `import_batches_source_kind_not_null` | n | `NOT NULL source_kind` |
| `import_batches_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['RECEIVED'::text, 'PROCESSING'::text, 'READY'::text, 'NEEDS_REVIEW'::text])))` |
| `import_batches_status_not_null` | n | `NOT NULL status` |
| `import_batches_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `import_batches_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `import_batches_created_by_idx`: `argolet.import_batches USING btree (created_by)`
- `import_batches_entity_idx`: `argolet.import_batches USING btree (tenant_id, entity_id)`

### integrations

Nguồn dữ liệu kết nối: POS, nền tảng giao đồ ăn, ngân hàng, hoá đơn điện tử, giấy tờ, Excel

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `kind` | text | có |
| `name` | text | có |
| `description` | text | có |
| `status` | text | có |
| `scope` | text | có |
| `connected_at` | timestamp with time zone |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `integrations_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `integrations_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `integrations_created_at_not_null` | n | `NOT NULL created_at` |
| `integrations_description_not_null` | n | `NOT NULL description` |
| `integrations_id_not_null` | n | `NOT NULL id` |
| `integrations_kind_check` | Kiểm tra | `CHECK ((kind = ANY (ARRAY['POS'::text, 'PLATFORM'::text, 'BANK'::text, 'EINVOICE'::text, 'PAPER'::text, 'EXCEL'::text])))` |
| `integrations_kind_not_null` | n | `NOT NULL kind` |
| `integrations_name_not_null` | n | `NOT NULL name` |
| `integrations_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `integrations_rev_not_null` | n | `NOT NULL rev` |
| `integrations_scope_not_null` | n | `NOT NULL scope` |
| `integrations_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['CONNECTED'::text, 'AVAILABLE'::text, 'PAUSED'::text])))` |
| `integrations_status_not_null` | n | `NOT NULL status` |
| `integrations_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `integrations_updated_at_not_null` | n | `NOT NULL updated_at` |

### intercompany_pairs

G4 · Cặp giao dịch nội bộ giữa hai pháp nhân (phải thu ↔ phải trả) và trạng thái khớp

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `reference` | text | có |
| `contract` | text | có |
| `period_id` | argolet.period_id | có |
| `side_a` | jsonb | có |
| `side_b` | jsonb | có |
| `status` | text | có |
| `next_action` | text | có |
| `requested_at` | timestamp with time zone |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `intercompany_pairs_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `intercompany_pairs_tenant_id_period_id_reference_key` | Duy nhất | `UNIQUE (tenant_id, period_id, reference)` |
| `intercompany_pairs_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `intercompany_pairs_contract_not_null` | n | `NOT NULL contract` |
| `intercompany_pairs_created_at_not_null` | n | `NOT NULL created_at` |
| `intercompany_pairs_id_not_null` | n | `NOT NULL id` |
| `intercompany_pairs_next_action_not_null` | n | `NOT NULL next_action` |
| `intercompany_pairs_period_id_not_null` | n | `NOT NULL period_id` |
| `intercompany_pairs_reference_not_null` | n | `NOT NULL reference` |
| `intercompany_pairs_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `intercompany_pairs_rev_not_null` | n | `NOT NULL rev` |
| `intercompany_pairs_side_a_check` | Kiểm tra | `CHECK (((jsonb_typeof(side_a) = 'object'::text) AND ((side_a ->> 'role'::text) = 'RECEIVABLE'::text)))` |
| `intercompany_pairs_side_a_not_null` | n | `NOT NULL side_a` |
| `intercompany_pairs_side_b_check` | Kiểm tra | `CHECK (((jsonb_typeof(side_b) = 'object'::text) AND ((side_b ->> 'role'::text) = 'PAYABLE'::text)))` |
| `intercompany_pairs_side_b_not_null` | n | `NOT NULL side_b` |
| `intercompany_pairs_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['MATCHED'::text, 'DIFFERENCE'::text, 'REQUESTED'::text])))` |
| `intercompany_pairs_status_not_null` | n | `NOT NULL status` |
| `intercompany_pairs_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `intercompany_pairs_updated_at_not_null` | n | `NOT NULL updated_at` |

### inventory_items

G1 · Nguyên vật liệu / hàng tồn kho theo cơ sở

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `entity_id` | text | có |
| `name` | text | có |
| `unit` | text | có |
| `on_hand` | argolet.non_negative | có |
| `reorder_level` | argolet.non_negative | có |
| `unit_cost` | argolet.non_negative | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `inventory_items_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `inventory_items_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `inventory_items_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `inventory_items_created_at_not_null` | n | `NOT NULL created_at` |
| `inventory_items_entity_id_not_null` | n | `NOT NULL entity_id` |
| `inventory_items_id_not_null` | n | `NOT NULL id` |
| `inventory_items_name_check` | Kiểm tra | `CHECK ((btrim(name) <> ''::text))` |
| `inventory_items_name_not_null` | n | `NOT NULL name` |
| `inventory_items_on_hand_not_null` | n | `NOT NULL on_hand` |
| `inventory_items_reorder_level_not_null` | n | `NOT NULL reorder_level` |
| `inventory_items_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `inventory_items_rev_not_null` | n | `NOT NULL rev` |
| `inventory_items_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `inventory_items_unit_cost_not_null` | n | `NOT NULL unit_cost` |
| `inventory_items_unit_not_null` | n | `NOT NULL unit` |
| `inventory_items_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `inventory_items_name_key`: `UNIQUE argolet.inventory_items USING btree (tenant_id, entity_id, lower(name))`

### invitations

Lời mời tham gia tổ chức với vai trò, phạm vi đơn vị và hạn mức phê duyệt

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `id` | text | có |
| `org_tenant_id` | text | có |
| `org_name` | text | có |
| `code` | text | có |
| `email` | argolet.email_address | có |
| `role` | text | có |
| `entity_ids` | jsonb | có |
| `scope_label` | text | có |
| `permissions_label` | text | có |
| `approval_limit` | argolet.non_negative |  |
| `invited_by` | text | có |
| `inviter_name` | text | có |
| `expires_at` | timestamp with time zone | có |
| `status` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `invitations_pkey` | Khoá chính | `PRIMARY KEY (id)` |
| `invitations_code_key` | Duy nhất | `UNIQUE (code)` |
| `invitations_invited_by_fk` | Khoá ngoại | `FOREIGN KEY (invited_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `invitations_tenant_fk` | Khoá ngoại | `FOREIGN KEY (org_tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `invitations_code_not_null` | n | `NOT NULL code` |
| `invitations_created_at_not_null` | n | `NOT NULL created_at` |
| `invitations_email_not_null` | n | `NOT NULL email` |
| `invitations_entity_ids_check` | Kiểm tra | `CHECK (((jsonb_typeof(entity_ids) = 'array'::text) OR (entity_ids = '"*"'::jsonb)))` |
| `invitations_entity_ids_not_null` | n | `NOT NULL entity_ids` |
| `invitations_expires_at_not_null` | n | `NOT NULL expires_at` |
| `invitations_id_not_null` | n | `NOT NULL id` |
| `invitations_invited_by_not_null` | n | `NOT NULL invited_by` |
| `invitations_inviter_name_not_null` | n | `NOT NULL inviter_name` |
| `invitations_org_name_not_null` | n | `NOT NULL org_name` |
| `invitations_org_tenant_id_not_null` | n | `NOT NULL org_tenant_id` |
| `invitations_permissions_label_not_null` | n | `NOT NULL permissions_label` |
| `invitations_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `invitations_rev_not_null` | n | `NOT NULL rev` |
| `invitations_role_check` | Kiểm tra | `CHECK ((role = ANY (ARRAY['ORG_ADMIN'::text, 'ACCOUNTANT'::text, 'CHIEF_ACCOUNTANT'::text, 'APPROVER'::text, 'STAFF'::text, 'VIEWER'::text, 'AUDITOR'::text, 'CLIENT_DELEGATE'::text, 'GROUP_CONTROLLER'::text])))` |
| `invitations_role_not_null` | n | `NOT NULL role` |
| `invitations_scope_label_not_null` | n | `NOT NULL scope_label` |
| `invitations_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'DECLINED'::text, 'EXPIRED'::text])))` |
| `invitations_status_not_null` | n | `NOT NULL status` |
| `invitations_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `invitations_email_idx`: `argolet.invitations USING btree (lower((email)::text))`
- `invitations_invited_by_idx`: `argolet.invitations USING btree (invited_by)`
- `invitations_tenant_idx`: `argolet.invitations USING btree (org_tenant_id)`

### ledger_states

Trạng thái sổ cái neo bằng chứng (kênh permissioned): khối, giao dịch đã cam kết

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `id` | text | có |
| `state` | jsonb | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `ledger_states_pkey` | Khoá chính | `PRIMARY KEY (id)` |
| `ledger_states_created_at_not_null` | n | `NOT NULL created_at` |
| `ledger_states_id_not_null` | n | `NOT NULL id` |
| `ledger_states_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `ledger_states_rev_not_null` | n | `NOT NULL rev` |
| `ledger_states_state_check` | Kiểm tra | `CHECK ((jsonb_typeof(state) = 'object'::text))` |
| `ledger_states_state_not_null` | n | `NOT NULL state` |
| `ledger_states_updated_at_not_null` | n | `NOT NULL updated_at` |

### legal_entities

Cơ cấu tổ chức: pháp nhân (LEGAL_ENTITY) và cơ sở / chi nhánh (SITE, thuộc một pháp nhân)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `name` | text | có |
| `short_name` | text | có |
| `code` | text | có |
| `kind` | text | có |
| `parent_id` | text |  |
| `base_currency` | argolet.currency_code | có |
| `timezone` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `legal_entities_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `legal_entities_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `legal_entities_parent_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, parent_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `legal_entities_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `legal_entities_base_currency_not_null` | n | `NOT NULL base_currency` |
| `legal_entities_check` | Kiểm tra | `CHECK (((parent_id IS NULL) OR (parent_id <> id)))` |
| `legal_entities_code_check` | Kiểm tra | `CHECK ((btrim(code) <> ''::text))` |
| `legal_entities_code_not_null` | n | `NOT NULL code` |
| `legal_entities_created_at_not_null` | n | `NOT NULL created_at` |
| `legal_entities_id_not_null` | n | `NOT NULL id` |
| `legal_entities_kind_check` | Kiểm tra | `CHECK ((kind = ANY (ARRAY['LEGAL_ENTITY'::text, 'SITE'::text])))` |
| `legal_entities_kind_not_null` | n | `NOT NULL kind` |
| `legal_entities_name_check` | Kiểm tra | `CHECK ((btrim(name) <> ''::text))` |
| `legal_entities_name_not_null` | n | `NOT NULL name` |
| `legal_entities_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `legal_entities_rev_not_null` | n | `NOT NULL rev` |
| `legal_entities_short_name_not_null` | n | `NOT NULL short_name` |
| `legal_entities_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `legal_entities_timezone_not_null` | n | `NOT NULL timezone` |
| `legal_entities_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `legal_entities_name_key`: `UNIQUE argolet.legal_entities USING btree (tenant_id, lower(name))`
- `legal_entities_parent_idx`: `argolet.legal_entities USING btree (tenant_id, parent_id)`

### match_groups

Nhóm đối soát: đơn hàng ↔ khoản tiền về, tổng gộp / phí / hoàn / chiết khấu / thực nhận, chênh lệch, giải thích và phân bổ (xem v_match_allocations)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `code` | text | có |
| `run_id` | text |  |
| `entity_id` | text | có |
| `period_id` | argolet.period_id | có |
| `kind` | text | có |
| `status` | text | có |
| `source_label` | text | có |
| `order_ids` | text[] | có |
| `txn_ids` | text[] | có |
| `gross` | numeric | có |
| `fee` | numeric | có |
| `refund` | numeric | có |
| `discount` | numeric | có |
| `adjustment` | numeric | có |
| `net` | numeric | có |
| `received` | numeric | có |
| `residual` | numeric | có |
| `score` | double precision | có |
| `links` | jsonb | có |
| `allocations` | jsonb | có |
| `explanation` | text | có |
| `basis` | text[] | có |
| `fee_rule` | text | có |
| `input_snapshot_version` | argolet.hex_text | có |
| `rules_version` | text | có |
| `confirmed_by` | text |  |
| `confirmed_at` | timestamp with time zone |  |
| `approval_id` | text |  |
| `version` | integer | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `match_groups_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `match_groups_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `match_groups_approval_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, approval_id) REFERENCES argolet.approvals(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `match_groups_confirmed_by_fk` | Khoá ngoại | `FOREIGN KEY (confirmed_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `match_groups_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `match_groups_run_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, run_id) REFERENCES argolet.recon_runs(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `match_groups_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `match_groups_adjustment_not_null` | n | `NOT NULL adjustment` |
| `match_groups_allocations_check` | Kiểm tra | `CHECK ((jsonb_typeof(allocations) = 'array'::text))` |
| `match_groups_allocations_not_null` | n | `NOT NULL allocations` |
| `match_groups_basis_not_null` | n | `NOT NULL basis` |
| `match_groups_check` | Kiểm tra | `CHECK (((confirmed_by IS NULL) = (confirmed_at IS NULL)))` |
| `match_groups_code_not_null` | n | `NOT NULL code` |
| `match_groups_created_at_not_null` | n | `NOT NULL created_at` |
| `match_groups_discount_not_null` | n | `NOT NULL discount` |
| `match_groups_entity_id_not_null` | n | `NOT NULL entity_id` |
| `match_groups_explanation_not_null` | n | `NOT NULL explanation` |
| `match_groups_fee_not_null` | n | `NOT NULL fee` |
| `match_groups_fee_rule_not_null` | n | `NOT NULL fee_rule` |
| `match_groups_gross_not_null` | n | `NOT NULL gross` |
| `match_groups_id_not_null` | n | `NOT NULL id` |
| `match_groups_input_snapshot_version_not_null` | n | `NOT NULL input_snapshot_version` |
| `match_groups_kind_check` | Kiểm tra | `CHECK ((kind = ANY (ARRAY['ONE_TO_ONE'::text, 'ONE_TO_MANY'::text, 'MANY_TO_ONE'::text, 'MANY_TO_MANY'::text])))` |
| `match_groups_kind_not_null` | n | `NOT NULL kind` |
| `match_groups_links_check` | Kiểm tra | `CHECK ((jsonb_typeof(links) = 'array'::text))` |
| `match_groups_links_not_null` | n | `NOT NULL links` |
| `match_groups_net_not_null` | n | `NOT NULL net` |
| `match_groups_order_ids_not_null` | n | `NOT NULL order_ids` |
| `match_groups_period_id_not_null` | n | `NOT NULL period_id` |
| `match_groups_received_not_null` | n | `NOT NULL received` |
| `match_groups_refund_not_null` | n | `NOT NULL refund` |
| `match_groups_residual_not_null` | n | `NOT NULL residual` |
| `match_groups_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `match_groups_rev_not_null` | n | `NOT NULL rev` |
| `match_groups_rules_version_not_null` | n | `NOT NULL rules_version` |
| `match_groups_score_check` | Kiểm tra | `CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))` |
| `match_groups_score_not_null` | n | `NOT NULL score` |
| `match_groups_source_label_not_null` | n | `NOT NULL source_label` |
| `match_groups_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['PROPOSED'::text, 'PENDING_APPROVAL'::text, 'CONFIRMED'::text, 'DISCREPANCY'::text])))` |
| `match_groups_status_not_null` | n | `NOT NULL status` |
| `match_groups_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `match_groups_txn_ids_not_null` | n | `NOT NULL txn_ids` |
| `match_groups_updated_at_not_null` | n | `NOT NULL updated_at` |
| `match_groups_version_check` | Kiểm tra | `CHECK ((version >= 1))` |
| `match_groups_version_not_null` | n | `NOT NULL version` |

Chỉ mục:

- `match_groups_approval_idx`: `argolet.match_groups USING btree (tenant_id, approval_id)`
- `match_groups_confirmed_by_idx`: `argolet.match_groups USING btree (confirmed_by)`
- `match_groups_period_idx`: `argolet.match_groups USING btree (tenant_id, entity_id, period_id)`
- `match_groups_run_idx`: `argolet.match_groups USING btree (tenant_id, run_id)`
- `match_groups_status_idx`: `argolet.match_groups USING btree (tenant_id, status)`

### memberships

Thành viên của tổ chức; bindings = các vai trò kèm phạm vi pháp nhân và hạn mức phê duyệt (xem v_membership_roles)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `user_id` | text | có |
| `display_name` | text | có |
| `title` | text | có |
| `bindings` | jsonb | có |
| `status` | text | có |
| `scope_label` | text | có |
| `limit_label` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `memberships_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `memberships_tenant_id_user_id_key` | Duy nhất | `UNIQUE (tenant_id, user_id)` |
| `memberships_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `memberships_user_fk` | Khoá ngoại | `FOREIGN KEY (user_id) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `memberships_bindings_check` | Kiểm tra | `CHECK ((jsonb_typeof(bindings) = 'array'::text))` |
| `memberships_bindings_not_null` | n | `NOT NULL bindings` |
| `memberships_created_at_not_null` | n | `NOT NULL created_at` |
| `memberships_display_name_not_null` | n | `NOT NULL display_name` |
| `memberships_id_not_null` | n | `NOT NULL id` |
| `memberships_limit_label_not_null` | n | `NOT NULL limit_label` |
| `memberships_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `memberships_rev_not_null` | n | `NOT NULL rev` |
| `memberships_scope_label_not_null` | n | `NOT NULL scope_label` |
| `memberships_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text, 'INVITED'::text])))` |
| `memberships_status_not_null` | n | `NOT NULL status` |
| `memberships_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `memberships_title_not_null` | n | `NOT NULL title` |
| `memberships_updated_at_not_null` | n | `NOT NULL updated_at` |
| `memberships_user_id_not_null` | n | `NOT NULL user_id` |

Chỉ mục:

- `memberships_user_idx`: `argolet.memberships USING btree (user_id)`

### notifications

Thông báo trong ứng dụng (toàn tổ chức hoặc riêng một người dùng)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `user_id` | text |  |
| `title` | text | có |
| `unit_label` | text | có |
| `ref_code` | text | có |
| `route` | text | có |
| `status` | text | có |
| `action_required` | boolean | có |
| `status_label` | text |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `notifications_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `notifications_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `notifications_user_fk` | Khoá ngoại | `FOREIGN KEY (user_id) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `notifications_action_required_not_null` | n | `NOT NULL action_required` |
| `notifications_created_at_not_null` | n | `NOT NULL created_at` |
| `notifications_id_not_null` | n | `NOT NULL id` |
| `notifications_ref_code_not_null` | n | `NOT NULL ref_code` |
| `notifications_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `notifications_rev_not_null` | n | `NOT NULL rev` |
| `notifications_route_not_null` | n | `NOT NULL route` |
| `notifications_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['UNREAD'::text, 'READ'::text])))` |
| `notifications_status_not_null` | n | `NOT NULL status` |
| `notifications_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `notifications_title_not_null` | n | `NOT NULL title` |
| `notifications_unit_label_not_null` | n | `NOT NULL unit_label` |
| `notifications_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `notifications_inbox_idx`: `argolet.notifications USING btree (tenant_id, status, created_at)`
- `notifications_user_idx`: `argolet.notifications USING btree (user_id)`

### projects

G3 · Dự án: ngân sách, chi phí đã ghi nhận / đã cam kết, cấu trúc công việc WBS (xem v_project_tasks)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `code` | text | có |
| `name` | text | có |
| `manager` | text | có |
| `budget` | argolet.non_negative | có |
| `recorded` | argolet.non_negative | có |
| `committed` | argolet.non_negative | có |
| `wbs` | jsonb | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `projects_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `projects_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `projects_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `projects_budget_not_null` | n | `NOT NULL budget` |
| `projects_code_not_null` | n | `NOT NULL code` |
| `projects_committed_not_null` | n | `NOT NULL committed` |
| `projects_created_at_not_null` | n | `NOT NULL created_at` |
| `projects_id_not_null` | n | `NOT NULL id` |
| `projects_manager_not_null` | n | `NOT NULL manager` |
| `projects_name_not_null` | n | `NOT NULL name` |
| `projects_recorded_not_null` | n | `NOT NULL recorded` |
| `projects_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `projects_rev_not_null` | n | `NOT NULL rev` |
| `projects_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `projects_updated_at_not_null` | n | `NOT NULL updated_at` |
| `projects_wbs_check` | Kiểm tra | `CHECK ((jsonb_typeof(wbs) = 'array'::text))` |
| `projects_wbs_not_null` | n | `NOT NULL wbs` |

### purchase_orders

G1 · Đơn mua hàng: nhà cung cấp, hạn thanh toán, số còn phải trả

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `code` | text | có |
| `supplier` | text | có |
| `entity_id` | text | có |
| `order_date` | date | có |
| `due_date` | date | có |
| `amount` | numeric | có |
| `outstanding` | numeric | có |
| `status` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `purchase_orders_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `purchase_orders_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `purchase_orders_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `purchase_orders_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `purchase_orders_amount_not_null` | n | `NOT NULL amount` |
| `purchase_orders_code_not_null` | n | `NOT NULL code` |
| `purchase_orders_created_at_not_null` | n | `NOT NULL created_at` |
| `purchase_orders_due_date_not_null` | n | `NOT NULL due_date` |
| `purchase_orders_entity_id_not_null` | n | `NOT NULL entity_id` |
| `purchase_orders_id_not_null` | n | `NOT NULL id` |
| `purchase_orders_order_date_not_null` | n | `NOT NULL order_date` |
| `purchase_orders_outstanding_not_null` | n | `NOT NULL outstanding` |
| `purchase_orders_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `purchase_orders_rev_not_null` | n | `NOT NULL rev` |
| `purchase_orders_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PENDING_APPROVAL'::text, 'RECEIVED'::text, 'AWAITING_INVOICE'::text, 'PAID'::text])))` |
| `purchase_orders_status_not_null` | n | `NOT NULL status` |
| `purchase_orders_supplier_not_null` | n | `NOT NULL supplier` |
| `purchase_orders_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `purchase_orders_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `purchase_orders_entity_idx`: `argolet.purchase_orders USING btree (tenant_id, entity_id)`

### read_projections

Bảng đọc tính sẵn (dashboard) cập nhật từ sự kiện

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `name` | text | có |
| `as_of_seq` | bigint | có |
| `data` | jsonb | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `read_projections_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `read_projections_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `read_projections_as_of_seq_check` | Kiểm tra | `CHECK ((as_of_seq >= 0))` |
| `read_projections_as_of_seq_not_null` | n | `NOT NULL as_of_seq` |
| `read_projections_created_at_not_null` | n | `NOT NULL created_at` |
| `read_projections_data_check` | Kiểm tra | `CHECK ((jsonb_typeof(data) = 'object'::text))` |
| `read_projections_data_not_null` | n | `NOT NULL data` |
| `read_projections_id_not_null` | n | `NOT NULL id` |
| `read_projections_name_not_null` | n | `NOT NULL name` |
| `read_projections_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `read_projections_rev_not_null` | n | `NOT NULL rev` |
| `read_projections_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `read_projections_updated_at_not_null` | n | `NOT NULL updated_at` |

### recipes

G1 · Định mức món / sản phẩm: giá bán, tỷ lệ hao hụt, các dòng nguyên liệu (xem v_recipe_lines)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `name` | text | có |
| `price` | argolet.non_negative | có |
| `waste_rate` | argolet.non_negative | có |
| `lines` | jsonb | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `recipes_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `recipes_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `recipes_created_at_not_null` | n | `NOT NULL created_at` |
| `recipes_id_not_null` | n | `NOT NULL id` |
| `recipes_lines_check` | Kiểm tra | `CHECK ((jsonb_typeof(lines) = 'array'::text))` |
| `recipes_lines_not_null` | n | `NOT NULL lines` |
| `recipes_name_check` | Kiểm tra | `CHECK ((btrim(name) <> ''::text))` |
| `recipes_name_not_null` | n | `NOT NULL name` |
| `recipes_price_not_null` | n | `NOT NULL price` |
| `recipes_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `recipes_rev_not_null` | n | `NOT NULL rev` |
| `recipes_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `recipes_updated_at_not_null` | n | `NOT NULL updated_at` |
| `recipes_waste_rate_not_null` | n | `NOT NULL waste_rate` |

### recon_runs

Lần chạy đối soát: ảnh chụp dữ liệu đầu vào (digest), phiên bản quy tắc, nhóm đề xuất và khoản chưa khớp

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `entity_id` | text | có |
| `period_id` | argolet.period_id | có |
| `input_snapshot_digest` | argolet.sha256_hex | có |
| `rules_version` | text | có |
| `group_ids` | text[] | có |
| `unmatched_orders` | text[] | có |
| `unmatched_txns` | text[] | có |
| `created_by` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `recon_runs_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `recon_runs_created_by_fk` | Khoá ngoại | `FOREIGN KEY (created_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `recon_runs_entity_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, entity_id) REFERENCES argolet.legal_entities(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `recon_runs_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `recon_runs_created_at_not_null` | n | `NOT NULL created_at` |
| `recon_runs_created_by_not_null` | n | `NOT NULL created_by` |
| `recon_runs_entity_id_not_null` | n | `NOT NULL entity_id` |
| `recon_runs_group_ids_not_null` | n | `NOT NULL group_ids` |
| `recon_runs_id_not_null` | n | `NOT NULL id` |
| `recon_runs_input_snapshot_digest_not_null` | n | `NOT NULL input_snapshot_digest` |
| `recon_runs_period_id_not_null` | n | `NOT NULL period_id` |
| `recon_runs_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `recon_runs_rev_not_null` | n | `NOT NULL rev` |
| `recon_runs_rules_version_not_null` | n | `NOT NULL rules_version` |
| `recon_runs_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `recon_runs_unmatched_orders_not_null` | n | `NOT NULL unmatched_orders` |
| `recon_runs_unmatched_txns_not_null` | n | `NOT NULL unmatched_txns` |
| `recon_runs_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `recon_runs_created_by_idx`: `argolet.recon_runs USING btree (created_by)`
- `recon_runs_period_idx`: `argolet.recon_runs USING btree (tenant_id, entity_id, period_id)`

### record_evidence

Liên kết bản ghi nghiệp vụ ↔ phiên bản chứng từ và vị trí trường dữ liệu làm căn cứ (bất biến)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `record_id` | text | có |
| `record_version` | integer | có |
| `document_id` | text | có |
| `document_version` | integer | có |
| `field_locator` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `record_evidence_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `record_evidence_document_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, document_id) REFERENCES argolet.documents(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `record_evidence_record_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, record_id) REFERENCES argolet.business_records(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `record_evidence_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `record_evidence_created_at_not_null` | n | `NOT NULL created_at` |
| `record_evidence_document_id_not_null` | n | `NOT NULL document_id` |
| `record_evidence_document_version_check` | Kiểm tra | `CHECK ((document_version >= 1))` |
| `record_evidence_document_version_not_null` | n | `NOT NULL document_version` |
| `record_evidence_field_locator_not_null` | n | `NOT NULL field_locator` |
| `record_evidence_id_not_null` | n | `NOT NULL id` |
| `record_evidence_record_id_not_null` | n | `NOT NULL record_id` |
| `record_evidence_record_version_check` | Kiểm tra | `CHECK ((record_version >= 1))` |
| `record_evidence_record_version_not_null` | n | `NOT NULL record_version` |
| `record_evidence_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `record_evidence_rev_not_null` | n | `NOT NULL rev` |
| `record_evidence_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `record_evidence_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `record_evidence_document_idx`: `argolet.record_evidence USING btree (tenant_id, document_id, document_version)`
- `record_evidence_record_idx`: `argolet.record_evidence USING btree (tenant_id, record_id)`

Trigger: `record_evidence_append_only` (chỉ ghi thêm).

### schema_migrations

—

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `version` | integer | có |
| `name` | text | có |
| `checksum` | text | có |
| `applied_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `schema_migrations_pkey` | Khoá chính | `PRIMARY KEY (version)` |
| `schema_migrations_applied_at_not_null` | n | `NOT NULL applied_at` |
| `schema_migrations_checksum_not_null` | n | `NOT NULL checksum` |
| `schema_migrations_name_not_null` | n | `NOT NULL name` |
| `schema_migrations_version_not_null` | n | `NOT NULL version` |

### sessions

Phiên đăng nhập (web / di động) – chỉ lưu giá trị băm của mã phiên; aal = mức xác thực

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `id` | text | có |
| `user_id` | text | có |
| `token_hash` | argolet.sha256_hex | có |
| `channel` | text | có |
| `aal` | integer | có |
| `expires_at` | timestamp with time zone | có |
| `last_seen_at` | timestamp with time zone | có |
| `user_agent` | text | có |
| `ip` | text | có |
| `remember` | boolean | có |
| `active_tenant_id` | text |  |
| `active_entity_id` | text | có |
| `revoked_at` | timestamp with time zone |  |
| `step_up_at` | timestamp with time zone |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `sessions_pkey` | Khoá chính | `PRIMARY KEY (id)` |
| `sessions_token_hash_key` | Duy nhất | `UNIQUE (token_hash)` |
| `sessions_active_tenant_fk` | Khoá ngoại | `FOREIGN KEY (active_tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `sessions_user_fk` | Khoá ngoại | `FOREIGN KEY (user_id) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `sessions_aal_check` | Kiểm tra | `CHECK ((aal = ANY (ARRAY[1, 2])))` |
| `sessions_aal_not_null` | n | `NOT NULL aal` |
| `sessions_active_entity_id_not_null` | n | `NOT NULL active_entity_id` |
| `sessions_channel_check` | Kiểm tra | `CHECK ((channel = ANY (ARRAY['web'::text, 'mobile'::text])))` |
| `sessions_channel_not_null` | n | `NOT NULL channel` |
| `sessions_created_at_not_null` | n | `NOT NULL created_at` |
| `sessions_expires_at_not_null` | n | `NOT NULL expires_at` |
| `sessions_id_not_null` | n | `NOT NULL id` |
| `sessions_ip_not_null` | n | `NOT NULL ip` |
| `sessions_last_seen_at_not_null` | n | `NOT NULL last_seen_at` |
| `sessions_remember_not_null` | n | `NOT NULL remember` |
| `sessions_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `sessions_rev_not_null` | n | `NOT NULL rev` |
| `sessions_token_hash_not_null` | n | `NOT NULL token_hash` |
| `sessions_updated_at_not_null` | n | `NOT NULL updated_at` |
| `sessions_user_agent_not_null` | n | `NOT NULL user_agent` |
| `sessions_user_id_not_null` | n | `NOT NULL user_id` |

Chỉ mục:

- `sessions_active_tenant_idx`: `argolet.sessions USING btree (active_tenant_id)`
- `sessions_user_idx`: `argolet.sessions USING btree (user_id)`

### shipments

G3 · Lô hàng logistics: hành trình, chứng từ, thời gian miễn phí lưu bãi, chi phí và phân bổ (xem v_shipment_costs)

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `code` | text | có |
| `route` | text | có |
| `container` | text | có |
| `status` | text | có |
| `events` | jsonb | có |
| `documents` | jsonb | có |
| `free_time_start` | date | có |
| `free_days` | integer | có |
| `tariff_code` | text | có |
| `tariff_from` | date | có |
| `storage_rate_per_day` | argolet.non_negative | có |
| `storage_days` | integer | có |
| `revenue` | argolet.non_negative | có |
| `costs` | jsonb | có |
| `allocation` | jsonb | có |
| `allocation_confirmed` | boolean | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `shipments_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `shipments_tenant_id_code_key` | Duy nhất | `UNIQUE (tenant_id, code)` |
| `shipments_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `shipments_allocation_check` | Kiểm tra | `CHECK ((jsonb_typeof(allocation) = 'array'::text))` |
| `shipments_allocation_confirmed_not_null` | n | `NOT NULL allocation_confirmed` |
| `shipments_allocation_not_null` | n | `NOT NULL allocation` |
| `shipments_code_not_null` | n | `NOT NULL code` |
| `shipments_container_not_null` | n | `NOT NULL container` |
| `shipments_costs_check` | Kiểm tra | `CHECK ((jsonb_typeof(costs) = 'array'::text))` |
| `shipments_costs_not_null` | n | `NOT NULL costs` |
| `shipments_created_at_not_null` | n | `NOT NULL created_at` |
| `shipments_documents_check` | Kiểm tra | `CHECK ((jsonb_typeof(documents) = 'array'::text))` |
| `shipments_documents_not_null` | n | `NOT NULL documents` |
| `shipments_events_check` | Kiểm tra | `CHECK ((jsonb_typeof(events) = 'array'::text))` |
| `shipments_events_not_null` | n | `NOT NULL events` |
| `shipments_free_days_check` | Kiểm tra | `CHECK ((free_days >= 0))` |
| `shipments_free_days_not_null` | n | `NOT NULL free_days` |
| `shipments_free_time_start_not_null` | n | `NOT NULL free_time_start` |
| `shipments_id_not_null` | n | `NOT NULL id` |
| `shipments_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `shipments_rev_not_null` | n | `NOT NULL rev` |
| `shipments_revenue_not_null` | n | `NOT NULL revenue` |
| `shipments_route_not_null` | n | `NOT NULL route` |
| `shipments_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['IN_TRANSIT'::text, 'CUSTOMS'::text, 'DELIVERING'::text, 'DELIVERED'::text])))` |
| `shipments_status_not_null` | n | `NOT NULL status` |
| `shipments_storage_days_check` | Kiểm tra | `CHECK ((storage_days >= 0))` |
| `shipments_storage_days_not_null` | n | `NOT NULL storage_days` |
| `shipments_storage_rate_per_day_not_null` | n | `NOT NULL storage_rate_per_day` |
| `shipments_tariff_code_not_null` | n | `NOT NULL tariff_code` |
| `shipments_tariff_from_not_null` | n | `NOT NULL tariff_from` |
| `shipments_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `shipments_updated_at_not_null` | n | `NOT NULL updated_at` |

### source_artifacts

Tệp gốc đã tiếp nhận: SHA-256 trên đúng từng byte, vị trí lưu trữ, nội dung văn bản (XML/CSV) để đối chiếu lại

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `tenant_id` | text | có |
| `id` | text | có |
| `batch_id` | text | có |
| `filename` | text | có |
| `mime` | text | có |
| `size` | bigint | có |
| `raw_sha256` | argolet.sha256_hex | có |
| `object_uri` | text | có |
| `source_key` | text | có |
| `received_at` | timestamp with time zone | có |
| `duplicate_of` | text |  |
| `content` | text |  |
| `content_bom` | boolean |  |
| `content_exact` | boolean |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `source_artifacts_pkey` | Khoá chính | `PRIMARY KEY (tenant_id, id)` |
| `source_artifacts_batch_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, batch_id) REFERENCES argolet.import_batches(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `source_artifacts_duplicate_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id, duplicate_of) REFERENCES argolet.source_artifacts(tenant_id, id) DEFERRABLE INITIALLY DEFERRED` |
| `source_artifacts_tenant_fk` | Khoá ngoại | `FOREIGN KEY (tenant_id) REFERENCES argolet.tenants(id) DEFERRABLE INITIALLY DEFERRED` |
| `source_artifacts_batch_id_not_null` | n | `NOT NULL batch_id` |
| `source_artifacts_check` | Kiểm tra | `CHECK (((duplicate_of IS NULL) OR (duplicate_of <> id)))` |
| `source_artifacts_created_at_not_null` | n | `NOT NULL created_at` |
| `source_artifacts_filename_not_null` | n | `NOT NULL filename` |
| `source_artifacts_id_not_null` | n | `NOT NULL id` |
| `source_artifacts_mime_not_null` | n | `NOT NULL mime` |
| `source_artifacts_object_uri_not_null` | n | `NOT NULL object_uri` |
| `source_artifacts_raw_sha256_not_null` | n | `NOT NULL raw_sha256` |
| `source_artifacts_received_at_not_null` | n | `NOT NULL received_at` |
| `source_artifacts_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `source_artifacts_rev_not_null` | n | `NOT NULL rev` |
| `source_artifacts_size_check` | Kiểm tra | `CHECK ((size >= 0))` |
| `source_artifacts_size_not_null` | n | `NOT NULL size` |
| `source_artifacts_source_key_not_null` | n | `NOT NULL source_key` |
| `source_artifacts_tenant_id_not_null` | n | `NOT NULL tenant_id` |
| `source_artifacts_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `source_artifacts_batch_idx`: `argolet.source_artifacts USING btree (tenant_id, batch_id)`
- `source_artifacts_duplicate_idx`: `argolet.source_artifacts USING btree (tenant_id, duplicate_of) WHERE (duplicate_of IS NOT NULL)`
- `source_artifacts_sha_idx`: `argolet.source_artifacts USING btree (tenant_id, raw_sha256)`

### tenants

Tổ chức (không gian làm việc) – đơn vị cô lập dữ liệu; settings: tiền tệ, múi giờ, chế độ kế toán, kỳ hiện tại, gói G1–G4

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `id` | text | có |
| `name` | text | có |
| `org_type` | text | có |
| `tax_code` | text |  |
| `policy_version` | text | có |
| `settings` | jsonb | có |
| `created_by` | text | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `tenants_pkey` | Khoá chính | `PRIMARY KEY (id)` |
| `tenants_created_by_fk` | Khoá ngoại | `FOREIGN KEY (created_by) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `tenants_created_at_not_null` | n | `NOT NULL created_at` |
| `tenants_created_by_not_null` | n | `NOT NULL created_by` |
| `tenants_id_not_null` | n | `NOT NULL id` |
| `tenants_name_check` | Kiểm tra | `CHECK ((btrim(name) <> ''::text))` |
| `tenants_name_not_null` | n | `NOT NULL name` |
| `tenants_org_type_not_null` | n | `NOT NULL org_type` |
| `tenants_policy_version_not_null` | n | `NOT NULL policy_version` |
| `tenants_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `tenants_rev_not_null` | n | `NOT NULL rev` |
| `tenants_settings_check` | Kiểm tra | `CHECK ((jsonb_typeof(settings) = 'object'::text))` |
| `tenants_settings_not_null` | n | `NOT NULL settings` |
| `tenants_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `tenants_created_by_idx`: `argolet.tenants USING btree (created_by)`

### users

Tài khoản người dùng (dùng chung mọi tổ chức); đăng nhập bằng email hoặc số điện thoại

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `id` | text | có |
| `full_name` | text | có |
| `email` | argolet.email_address |  |
| `phone` | text |  |
| `status` | text | có |
| `verified_at` | timestamp with time zone |  |
| `totp_secret` | text |  |
| `mfa_enabled_at` | timestamp with time zone |  |
| `failed_logins` | integer | có |
| `locked_until` | timestamp with time zone |  |
| `last_login_at` | timestamp with time zone |  |
| `pending_invitation_code` | text |  |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `users_pkey` | Khoá chính | `PRIMARY KEY (id)` |
| `users_check` | Kiểm tra | `CHECK (((email IS NOT NULL) OR (phone IS NOT NULL)))` |
| `users_created_at_not_null` | n | `NOT NULL created_at` |
| `users_failed_logins_check` | Kiểm tra | `CHECK ((failed_logins >= 0))` |
| `users_failed_logins_not_null` | n | `NOT NULL failed_logins` |
| `users_full_name_check` | Kiểm tra | `CHECK ((btrim(full_name) <> ''::text))` |
| `users_full_name_not_null` | n | `NOT NULL full_name` |
| `users_id_not_null` | n | `NOT NULL id` |
| `users_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `users_rev_not_null` | n | `NOT NULL rev` |
| `users_status_check` | Kiểm tra | `CHECK ((status = ANY (ARRAY['PENDING_VERIFICATION'::text, 'ACTIVE'::text, 'LOCKED'::text])))` |
| `users_status_not_null` | n | `NOT NULL status` |
| `users_updated_at_not_null` | n | `NOT NULL updated_at` |

Chỉ mục:

- `users_email_key`: `UNIQUE argolet.users USING btree (lower((email)::text)) WHERE (email IS NOT NULL)`
- `users_phone_key`: `UNIQUE argolet.users USING btree (phone) WHERE (phone IS NOT NULL)`

### verification_tokens

Mã xác minh một lần (xác minh liên hệ, đặt lại mật khẩu, xác thực bước hai) – chỉ lưu giá trị băm

| Cột | Kiểu | Bắt buộc |
| --- | --- | --- |
| `id` | text | có |
| `user_id` | text | có |
| `purpose` | text | có |
| `token_hash` | argolet.sha256_hex | có |
| `expires_at` | timestamp with time zone | có |
| `attempts` | integer | có |
| `consumed_at` | timestamp with time zone |  |
| `sent_to` | text | có |
| `last_sent_at` | timestamp with time zone | có |
| `rev` | integer | có |
| `created_at` | timestamp with time zone | có |
| `updated_at` | timestamp with time zone | có |

| Ràng buộc | Loại | Định nghĩa |
| --- | --- | --- |
| `verification_tokens_pkey` | Khoá chính | `PRIMARY KEY (id)` |
| `verification_tokens_user_fk` | Khoá ngoại | `FOREIGN KEY (user_id) REFERENCES argolet.users(id) DEFERRABLE INITIALLY DEFERRED` |
| `verification_tokens_attempts_check` | Kiểm tra | `CHECK ((attempts >= 0))` |
| `verification_tokens_attempts_not_null` | n | `NOT NULL attempts` |
| `verification_tokens_created_at_not_null` | n | `NOT NULL created_at` |
| `verification_tokens_expires_at_not_null` | n | `NOT NULL expires_at` |
| `verification_tokens_id_not_null` | n | `NOT NULL id` |
| `verification_tokens_last_sent_at_not_null` | n | `NOT NULL last_sent_at` |
| `verification_tokens_purpose_check` | Kiểm tra | `CHECK ((purpose = ANY (ARRAY['VERIFY_CONTACT'::text, 'RESET_PASSWORD'::text, 'STEP_UP'::text])))` |
| `verification_tokens_purpose_not_null` | n | `NOT NULL purpose` |
| `verification_tokens_rev_check` | Kiểm tra | `CHECK ((rev >= 1))` |
| `verification_tokens_rev_not_null` | n | `NOT NULL rev` |
| `verification_tokens_sent_to_not_null` | n | `NOT NULL sent_to` |
| `verification_tokens_token_hash_not_null` | n | `NOT NULL token_hash` |
| `verification_tokens_updated_at_not_null` | n | `NOT NULL updated_at` |
| `verification_tokens_user_id_not_null` | n | `NOT NULL user_id` |

Chỉ mục:

- `verification_tokens_user_idx`: `argolet.verification_tokens USING btree (user_id, purpose)`

## View báo cáo

| View | Mô tả |
| --- | --- |
| `v_close_snapshot_members` | Các bản ghi (đúng phiên bản và digest) nằm trong mỗi lần chốt kỳ |
| `v_document_lines` | Dòng chi tiết của chứng từ (hàng hoá / dịch vụ, số tiền chưa VAT) |
| `v_evidence_leaves` | Các lá Merkle của từng lô bằng chứng |
| `v_match_allocations` | Phân bổ của từng nhóm đối soát xuống từng bản ghi (đơn hàng / khoản nhận tiền) |
| `v_membership_roles` | Vai trò của từng thành viên: phạm vi pháp nhân (* = toàn tổ chức) và hạn mức phê duyệt |
| `v_period_reconciliation` | Tổng hợp đối soát theo đơn vị và kỳ: số nhóm theo trạng thái, tổng gộp / phí / thực nhận / chênh lệch |
| `v_project_tasks` | Công việc WBS của dự án: phụ thuộc, người phụ trách, tiến độ |
| `v_recipe_lines` | Định lượng nguyên liệu của từng món |
| `v_shipment_costs` | Chi phí của từng lô hàng |
