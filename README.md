# ARGOLET

Nền tảng tiếp nhận chứng từ, đối soát đa nguồn, phê duyệt, chốt kỳ và bằng chứng toàn vẹn cho doanh nghiệp Việt Nam — **Web · Android · iOS**, xây dựng theo sơ đồ hoạt động (FigJam) và bộ giao diện Figma "ARGOLET · Web app · Android · iOS · 4.2" (40 màn hình).

**Tài khoản trải nghiệm:** `ketoan@minhan.example` · mật khẩu `Argolet@2026` (dữ liệu mẫu "Minh An Commerce", kỳ tháng 10/2026).

## Cấu trúc

| Thư mục           | Nội dung                                                                                                                                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | Lõi nghiệp vụ thuần TypeScript: Merkle tree, sổ cái mô phỏng Hyperledger Fabric, dấu vân tay có muối, đối soát M:N (Hungarian + phân bổ FIFO), động cơ tài chính (NPV/IRR/hoàn vốn/DSCR, kịch bản, giá thành, landed cost…), RBAC/ABAC + SoD, phê duyệt gắn digest, chốt kỳ, outbox/inbox, OTP/TOTP |
| `packages/app`    | Tầng ứng dụng: dịch vụ, hợp đồng API (`operations`), dữ liệu mẫu, kho dữ liệu trong bộ nhớ                                                                                                                                                                                                          |
| `packages/client` | Client dùng chung cho web & mobile: HTTP (cookie/Bearer) hoặc chạy toàn bộ ứng dụng ngay trên thiết bị                                                                                                                                                                                              |
| `apps/api`        | Máy chủ Fastify 5 + PostgreSQL 16 (hoặc PGlite nhúng), Argon2id, CSRF, cookie HttpOnly, giới hạn tần suất, trợ lý Claude                                                                                                                                                                            |
| `apps/web`        | Ứng dụng web React 19 + Vite (40 màn hình theo Figma)                                                                                                                                                                                                                                               |
| `apps/mobile`     | Ứng dụng Expo SDK 58 / React Native cho Android và iOS                                                                                                                                                                                                                                              |
| `e2e`             | Kiểm thử đầu-cuối Playwright trên bản build production                                                                                                                                                                                                                                              |

**Công nghệ:** TypeScript 6 (strict) · React 19 + Vite 8 · Expo SDK 58 / React Native 0.88 · Fastify 5 · PostgreSQL 16 / PGlite · Node.js 26 LTS · Vitest 5 · Playwright · ESLint 10 + Prettier (kiểm tra trong CI).

## Chạy trên máy

Yêu cầu Node.js ≥ 22.12 (khuyến nghị Node 26 LTS — bản dùng trong Docker và CI) và pnpm 10 (`npm install -g pnpm@10`).

```bash
pnpm install
```

```bash
pnpm dev:web
```

Mở http://localhost:5173 — không cần máy chủ: ứng dụng tự chạy trong trình duyệt với dữ liệu mẫu (lưu ở localStorage).

Chạy kèm máy chủ API (PGlite nhúng, tự tạo dữ liệu mẫu):

```bash
pnpm dev:api
```

```bash
ARGOLET_API=http://localhost:8080 pnpm dev:web
```

Ứng dụng di động (quét QR bằng Expo Go, hoặc nhấn `a` / `i` để mở trình giả lập):

```bash
pnpm dev:mobile
```

## Kiểm thử

```bash
pnpm check
```

`pnpm check` chạy lần lượt: typecheck toàn bộ · ESLint (0 cảnh báo) · unit/integration (core, app, API, web) · build · E2E Playwright. Từng bước riêng:

| Lệnh             | Phạm vi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` | TypeScript strict cho mọi gói (kể cả mobile, e2e)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm lint`      | ESLint flat config, `--max-warnings=0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm test`      | Lõi nghiệp vụ · tầng ứng dụng (gồm kịch bản **công ty mới trên hệ thống trống** chạy hết mọi phân hệ, kiểm tra toàn vẹn theo từng byte) · API (kịch bản công ty mới trên PGlite và PostgreSQL thật khi đặt `PG_TEST_URL`, gửi email qua SMTP thật, phân trang qua HTTP) · giao diện web                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm test:e2e`  | Trình duyệt thật trên bản build production, 3 dự án: **static** (web tĩnh) và **api** (máy chủ có dữ liệu mẫu) — mọi màn hình ở 1440 px và 390 px, phân trang chứng từ, duyệt chi, xác nhận chứng từ, kiểm chứng toàn vẹn, đối soát, chốt ca, đơn mua, thẩm định, mời thành viên, trợ lý, đăng ký → xác minh → tạo tổ chức → đặt lại mật khẩu; **fresh** — máy chủ cơ sở dữ liệu trống: một công ty mới đi hết sản phẩm qua giao diện (tiếp nhận tệp POS/sao kê/hóa đơn điện tử/ảnh, đối soát, chốt ca, kho & công thức, đơn mua được người thứ hai duyệt, dự án, thẩm định, tài sản, logistics, công ty con & đối soát nội bộ, chốt kỳ có xác thực bổ sung, chuyển sang tháng sau, kiểm chứng tệp gốc) |

E2E cần build trước (`pnpm build`) và Chromium của Playwright (`pnpm --filter @argolet/e2e exec playwright install chromium`). CI trên GitHub Actions (`.github/workflows/ci.yml`) chạy toàn bộ các vòng trên cùng PostgreSQL 16 và đóng gói mobile cho Android/iOS/web.

## Triển khai

### 1. Web tĩnh (không cần máy chủ)

`pnpm --filter @argolet/web build` tạo `apps/web/dist` — đặt lên bất kỳ hosting tĩnh nào (GitHub Pages, Cloudflare Pages, Netlify, Vercel, S3…). Toàn bộ nghiệp vụ chạy trong trình duyệt với dữ liệu mẫu riêng cho từng người dùng.

**GitHub Pages:** workflow `.github/workflows/pages.yml` tự build và xuất bản khi đẩy lên nhánh. Bật một lần: _Settings → Pages → Build and deployment → Source: GitHub Actions_. Địa chỉ: `https://konkonban.github.io/ARGOLET/`. Tên miền riêng: thêm ở _Settings → Pages → Custom domain_ và tạo bản ghi DNS `CNAME` trỏ về `konkonban.github.io`.

### 2. Máy chủ đầy đủ (API + web, dữ liệu dùng chung) — dùng cho doanh nghiệp thật

```bash
docker build -t argolet .
```

```bash
docker run -d -p 8080:8080 -e PEPPER="$(openssl rand -hex 32)" -v argolet-data:/data argolet
```

Cho doanh nghiệp thật: đặt `DEMO_SEED=false` (cơ sở dữ liệu bắt đầu trống, đồng hồ thật), `SMTP_URL` + `MAIL_FROM` để người dùng nhận mã qua email, và dùng PostgreSQL (`DATABASE_URL=postgres://…`) có sao lưu định kỳ. Người tạo tổ chức có quyền quản trị và kế toán trưởng; mời thêm người duyệt để tách người lập và người duyệt.

Image chạy bằng người dùng không phải root, phục vụ cả API lẫn web trên cổng 8080, lưu dữ liệu PGlite ở volume `/data` (hoặc trỏ `DATABASE_URL` tới PostgreSQL). Đặt sau reverse proxy có HTTPS (cookie phiên `Secure` khi `NODE_ENV=production`). Chạy được trên Render, Fly.io, Railway, Google Cloud Run, VPS…; gắn tên miền riêng tại nhà cung cấp đó.

| Biến môi trường                | Mặc định                                                                        | Ý nghĩa                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PEPPER`                       | —                                                                               | **Bắt buộc ở production**, ≥ 32 ký tự ngẫu nhiên (khóa bí mật để băm mã xác minh và tham chiếu lô bằng chứng)                                                                                                       |
| `DATABASE_URL`                 | `pglite:/data/pglite` (Docker)                                                  | `postgres://…` hoặc `pglite:<thư mục>` / `pglite:memory`                                                                                                                                                            |
| `PORT`, `HOST`                 | `8080`, `0.0.0.0`                                                               | Cổng lắng nghe                                                                                                                                                                                                      |
| `DEMO_SEED`                    | `true`                                                                          | Tạo dữ liệu mẫu Minh An Commerce khi CSDL trống                                                                                                                                                                     |
| `DEMO_CLOCK`                   | theo `DEMO_SEED`                                                                | Đồng hồ bắt đầu từ 31/10/2026 09:40 để khớp dữ liệu mẫu                                                                                                                                                             |
| `SMTP_URL`                     | —                                                                               | Máy chủ gửi email, ví dụ `smtps://user:mat-khau@smtp.example.com:465` (Amazon SES, SendGrid, Mailgun, Google Workspace, Zoho…). Bật gửi mã xác minh, mã đặt lại mật khẩu, mã xác thực bổ sung và thư mời thành viên |
| `MAIL_FROM`                    | `ARGOLET <no-reply@argolet.local>`                                              | Người gửi hiển thị trong email                                                                                                                                                                                      |
| `EXPOSE_DEV_CODES`             | bật khi chưa cấu hình `SMTP_URL` và (không phải production hoặc có dữ liệu mẫu) | Hiển thị mã OTP trên giao diện thay vì gửi email — chỉ dùng cho thử nghiệm                                                                                                                                          |
| `ANTHROPIC_API_KEY`            | —                                                                               | Bật trợ lý Claude và trích xuất chứng từ bằng thị giác; không đặt thì dùng trợ lý theo luật                                                                                                                         |
| `ARGOLET_CLAUDE_MODEL`         | `claude-opus-5-5`                                                               | Model Claude cho trợ lý                                                                                                                                                                                             |
| `PUBLIC_BASE_URL`              | `http://localhost:<PORT>`                                                       | Địa chỉ công khai (liên kết trong thông báo)                                                                                                                                                                        |
| `CORS_ORIGINS`                 | —                                                                               | Danh sách origin được phép, phân tách bằng dấu phẩy (khi web chạy ở tên miền khác)                                                                                                                                  |
| `COOKIE_SECURE`, `TRUST_PROXY` | theo `NODE_ENV`                                                                 | Cookie `Secure`; tin cậy `X-Forwarded-*` từ reverse proxy                                                                                                                                                           |
| `WEB_DIST`                     | tự dò                                                                           | Thư mục web build mà API phục vụ                                                                                                                                                                                    |

Trợ lý Claude dùng Messages API với _adaptive thinking_ và bật **server-side fallbacks** (`fallbacks: "default"`): khi model chính từ chối một yêu cầu, Anthropic tự chuyển sang model dự phòng.

### 3. Ứng dụng Android / iOS

Ứng dụng tự kết nối máy chủ khi có `EXPO_PUBLIC_API_URL` (hoặc người dùng nhập ở màn hình _Máy chủ ARGOLET_); nếu không, chạy toàn bộ trên thiết bị với dữ liệu mẫu. Bản cài đặt dựng bằng EAS Build (cần tài khoản Expo; iOS cần Apple Developer):

```bash
npm i -g eas-cli
```

```bash
cd apps/mobile && eas build --platform android --profile preview
```

```bash
cd apps/mobile && eas build --platform ios --profile production
```

Đặt địa chỉ API trong `apps/mobile/eas.json` (`EXPO_PUBLIC_API_URL`) trước khi dựng bản production. Mã gói: `vn.argolet.app`.

## Bảo mật (tóm tắt)

Mật khẩu Argon2id (máy chủ) · phiên HttpOnly + SameSite=Lax + CSRF header cho web, Bearer lưu SecureStore cho mobile · khóa tài khoản khi đăng nhập sai nhiều lần · TOTP/OTP · xác thực bổ sung (AAL2) cho phê duyệt từ 50 triệu đ · phân tách nhiệm vụ · phê duyệt gắn digest phiên bản · nhật ký kiểm toán · CSP/Helmet · giới hạn tần suất.
