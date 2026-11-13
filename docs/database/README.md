# Cơ sở dữ liệu ARGOLET

ARGOLET lưu dữ liệu trong **PostgreSQL 16+**, lược đồ `argolet`. Khi phát triển, chạy thử hoặc demo một máy, có thể dùng **PGlite**: cũng là PostgreSQL, nhưng nhúng trong tiến trình, lưu trong bộ nhớ hoặc trên đĩa. Cả hai chạy cùng một lược đồ và cùng một bộ kiểm thử.

- Danh mục đầy đủ từng bảng, cột, khoá, ràng buộc và chỉ mục: [data-dictionary.md](data-dictionary.md). Tệp này được sinh tự động từ lược đồ thật; một test sẽ báo lỗi nếu tệp bị lệch.
- Mã nguồn:
  - `apps/api/src/db/migrations/`: các bản migration SQL.
  - `apps/api/src/db/tables.ts`: ánh xạ trường ↔ cột, được trình biên dịch kiểm tra.
  - `apps/api/src/db/store.ts`: lớp lưu trữ.

## Nguyên tắc thiết kế

| Nguyên tắc                                        | Cách thực hiện                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mỗi đối tượng nghiệp vụ một bảng, cột có kiểu** | 45 bảng nghiệp vụ. Tiền và số lượng dùng `numeric` (không làm tròn kiểu số thực), thời điểm dùng `timestamptz`, ngày dùng `date`, cờ dùng `boolean`. JSONB chỉ dành cho giá trị luôn đi cùng bản ghi cha, như dòng hoá đơn, công việc WBS hay phân bổ đối soát; các phần này có view quan hệ `v_*` để truy vấn.                                                                                                         |
| **Cô lập dữ liệu giữa các tổ chức**               | Bảng của tổ chức có khoá chính `(tenant_id, id)`. Mọi tham chiếu giữa các bảng này là khoá ngoại ghép có `tenant_id`, nên một bản ghi không bao giờ trỏ được sang dữ liệu của tổ chức khác.                                                                                                                                                                                                                             |
| **Toàn vẹn tham chiếu**                           | 86 khoá ngoại, tất cả `DEFERRABLE INITIALLY DEFERRED`: một lệnh ghi cả nhóm dữ liệu theo thứ tự bất kỳ, và PostgreSQL kiểm tra khi giao dịch kết thúc. Không có xoá dây chuyền (`CASCADE`), nên dữ liệu kế toán không bao giờ tự biến mất.                                                                                                                                                                              |
| **Ràng buộc nghiệp vụ trong CSDL**                | 166 ràng buộc `CHECK`, phủ mọi danh mục trạng thái và vai trò. Kiểu miền (domain) kiểm tra định dạng kỳ `YYYY-MM`, mã tiền tệ, giá trị băm SHA-256, email và số không âm. Các quy tắc như "đã duyệt thì phải có thời điểm duyệt" hay "kỳ đã chốt thì phải có ảnh chụp chốt kỳ" cũng do CSDL kiểm tra. Ngày và thời điểm chỉ nhận định dạng ISO-8601, nên `01/12/2026` bị từ chối thay vì bị đoán là ngày 12/1 hay 1/12. |
| **Duy nhất**                                      | Mã chứng từ, mã nhóm đối soát, mã lô, mã đơn mua, mã hợp đồng… duy nhất trong từng tổ chức. Email người dùng duy nhất, không phân biệt hoa thường. Một người chỉ có một tư cách thành viên trong mỗi tổ chức. Nếu bị trùng, API trả về lỗi `409 CONFLICT` với thông báo tiếng Việt.                                                                                                                                     |
| **Lịch sử bất biến**                              | Trigger chặn sửa và xoá trên: nhật ký kiểm toán, phiên bản chứng từ, liên kết bằng chứng, biên nhận và lô bằng chứng, nhật ký kiểm tra toàn vẹn, ảnh chụp chốt kỳ (chỉ được đổi trạng thái neo), lần tính toán tài chính, và hộp thư sự kiện đã xử lý.                                                                                                                                                                  |
| **Giao dịch an toàn**                             | Mỗi lệnh chạy trong một giao dịch `SERIALIZABLE`, tự thử lại khi xung đột. Dữ liệu nghiệp vụ, sự kiện miền (outbox) và nhật ký được ghi cùng một giao dịch. Khoá lạc quan dùng cột `rev`.                                                                                                                                                                                                                               |
| **Chỉ mục**                                       | Mọi khoá ngoại đều có chỉ mục; có test kiểm tra điều này. Thêm chỉ mục cho các truy vấn thường dùng: chứng từ theo trạng thái và ngày, bản ghi chưa khớp theo kỳ, nhóm đối soát theo trạng thái, hộp thư đi chưa phát…                                                                                                                                                                                                  |

## Sơ đồ quan hệ chính

```mermaid
erDiagram
  users ||--|| credentials : "mật khẩu"
  users ||--o{ sessions : "phiên"
  users ||--o{ memberships : "thuộc"
  tenants ||--o{ memberships : "thành viên"
  tenants ||--o{ legal_entities : "cơ cấu"
  legal_entities ||--o{ legal_entities : "cơ sở thuộc pháp nhân"
  tenants ||--o{ invitations : "lời mời"
  legal_entities ||--o{ import_batches : "lô tiếp nhận"
  import_batches ||--o{ source_artifacts : "tệp gốc"
  source_artifacts ||--o{ documents : "chứng từ"
  documents ||--o{ document_versions : "phiên bản đã xác nhận"
  documents ||--o{ business_records : "sinh bản ghi"
  business_records ||--o{ record_evidence : "căn cứ"
  documents ||--o{ record_evidence : "căn cứ"
  recon_runs ||--o{ match_groups : "đề xuất"
  match_groups ||--o{ business_records : "khớp"
  approvals ||--o{ match_groups : "phê duyệt"
  legal_entities ||--o{ accounting_periods : "kỳ"
  close_snapshots ||--o| accounting_periods : "chốt"
  close_snapshots ||--o| close_snapshots : "lần chốt trước"
  evidence_batches ||--o{ evidence_receipts : "biên nhận"
  calc_runs ||--o{ finance_projects : "lần tính gần nhất"
```

## Nhóm bảng

| Nhóm                                    | Bảng                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Danh tính & truy cập (dùng chung)       | `users`, `credentials`, `verification_tokens`, `sessions`, `invitations`                                                                                       |
| Tổ chức                                 | `tenants`, `legal_entities`, `memberships`, `integrations`                                                                                                     |
| Tiếp nhận & chứng từ                    | `import_batches`, `source_artifacts`, `documents`, `document_versions`, `business_records`, `business_record_history`, `record_evidence`                       |
| Đối soát                                | `recon_runs`, `match_groups`                                                                                                                                   |
| Phê duyệt, chốt kỳ, bằng chứng          | `approvals`, `accounting_periods`, `close_snapshots`, `evidence_batches`, `evidence_receipts`, `evidence_verifications`, `ledger_states`                       |
| Tài chính, trợ lý, thông báo, kiểm toán | `calc_runs`, `finance_projects`, `assistant_conversations`, `notifications`, `audit_log`                                                                       |
| Sự kiện                                 | `event_outbox`, `event_inbox`, `aggregate_sequences`, `read_projections`                                                                                       |
| Phân hệ G1–G4                           | `inventory_items`, `recipes`, `purchase_orders`, `daily_closes`, `clients`, `deals`, `projects`, `assets`, `shipments`, `group_entities`, `intercompany_pairs` |

View báo cáo (dùng cho BI hoặc truy vấn trực tiếp):

- `v_period_reconciliation`
- `v_match_allocations`
- `v_close_snapshot_members`
- `v_evidence_leaves`
- `v_document_lines`
- `v_membership_roles`
- `v_project_tasks`
- `v_shipment_costs`
- `v_recipe_lines`

Ví dụ: tổng hợp đối soát theo cơ sở và kỳ.

```sql
SELECT entity_id, period_id, groups_confirmed, groups_to_confirm, discrepancies, net, received, residual
  FROM argolet.v_period_reconciliation
 WHERE tenant_id = 'ten_minhan'
 ORDER BY period_id DESC, entity_id;
```

## Vận hành

**Kết nối.** Đặt biến môi trường `DATABASE_URL`:

- `postgres://user:pass@host:5432/argolet`: máy chủ PostgreSQL. Thêm `PGSSL=require` nếu dùng SSL; `PG_POOL_MAX` đặt số kết nối, mặc định 10.
- `pglite:/đường/dẫn/thư-mục`: PGlite lưu trên đĩa.
- `pglite:memory`: PGlite trong bộ nhớ, mất dữ liệu khi tắt máy chủ.

**Migration.** Máy chủ tự áp dụng migration khi khởi động:

- Tất cả chạy trong một giao dịch, có khoá tư vấn (advisory lock) để nhiều máy chủ khởi động cùng lúc vẫn an toàn.
- Mỗi migration được ghi vào `argolet.schema_migrations` kèm checksum. Nếu ai đó sửa một migration đã áp dụng, máy chủ từ chối khởi động. Máy chủ cũng từ chối khi CSDL đang ở phiên bản lược đồ mới hơn bản máy chủ hỗ trợ.
- `GET /healthz` trả về phiên bản lược đồ đang dùng.

**Nâng cấp từ bản đầu tiên.** CSDL của bản cũ lưu mọi thứ dạng JSON trong bảng `public.argolet_rows`. Khi khởi động, máy chủ tự chép toàn bộ dữ liệu sang các bảng có kiểu, trong cùng giao dịch và kiểm tra đủ mọi ràng buộc. Bảng cũ được giữ lại dưới tên `public.argolet_rows_v1_backup` để đối chiếu hoặc khôi phục.

**Thêm một thay đổi lược đồ.**

1. Tạo `apps/api/src/db/migrations/000N_ten.ts` và đăng ký trong `migrate.ts`. Không sửa migration cũ.
2. Cập nhật `tables.ts` (trình biên dịch sẽ chỉ ra trường còn thiếu).
3. Chạy `pnpm --filter @argolet/api db:docs`, rồi chạy test.

**Sao lưu và khôi phục** (PostgreSQL):

```bash
pg_dump --format=custom --schema=argolet --file=argolet-$(date +%F).dump "$DATABASE_URL"
```

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" argolet-2026-11-13.dump
```

Với PGlite lưu trên đĩa, chỉ cần sao lưu cả thư mục dữ liệu khi máy chủ đã dừng.

## Kiểm thử

`apps/api/test/db.test.ts` luôn chạy trên PGlite, và chạy thêm trên PostgreSQL thật khi có `PG_TEST_URL` (CI dùng PostgreSQL 16). Bộ test kiểm tra:

- lược đồ khớp ánh xạ: đủ bảng, đủ cột, đúng kiểu, đúng `NOT NULL`;
- mọi khoá ngoại đều trì hoãn đến cuối giao dịch và đều có chỉ mục;
- **mọi bản ghi** của bộ dữ liệu demo và của một công ty mới (đủ phân hệ) đọc ra giống hệt lúc ghi;
- khoá ngoại (kể cả không tham chiếu chéo tổ chức), tính duy nhất, danh mục, định dạng, khoảng giá trị và lịch sử bất biến đều được thực thi;
- migration có checksum, chạy lại không làm gì thêm, và nâng cấp đúng CSDL bản cũ;
- các view báo cáo trả về số liệu khớp với bảng gốc.

Ngoài ra, toàn bộ API, kịch bản công ty mới và E2E đều chạy trên chính lược đồ này.
