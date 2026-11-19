# ARGOLET

Nền tảng tiếp nhận chứng từ, đối soát đa nguồn, phê duyệt, chốt kỳ và bằng chứng toàn vẹn cho doanh nghiệp Việt Nam — **Web · Android · iOS**, xây dựng theo sơ đồ hoạt động (FigJam) và bộ giao diện Figma "ARGOLET · Web app · Android · iOS · 4.2" (40 màn hình).

**Mở trực tiếp:** https://konkonban.github.io/ARGOLET/ (máy tính và điện thoại).

**Người lớn tuổi:** nút **Chữ lớn** ở thanh trên cùng (web) và mục **Cỡ chữ** (Thường · Lớn · Rất lớn) ở màn Thêm / Đăng nhập (mobile); bố cục tự sắp xếp lại theo cỡ chữ, app mobile cũng theo cỡ chữ của điện thoại.

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

## Cơ sở dữ liệu

PostgreSQL 16+ (hoặc PGlite nhúng), lược đồ quan hệ `argolet`:

- 45 bảng nghiệp vụ, cột có kiểu (`numeric` cho tiền, `timestamptz`, `date`…).
- 86 khoá ngoại, có kèm `tenant_id`, nên dữ liệu các tổ chức không bao giờ tham chiếu chéo.
- 166 ràng buộc `CHECK`, cùng các ràng buộc duy nhất theo từng tổ chức.
- Lịch sử bất biến (nhật ký kiểm toán, phiên bản chứng từ, bằng chứng) do trigger bảo vệ.
- Migration có phiên bản và checksum; CSDL của bản đầu tiên được tự nâng cấp.

Tài liệu thiết kế và sơ đồ quan hệ: [docs/database](docs/database/README.md). Từ điển dữ liệu sinh tự động: [docs/database/data-dictionary.md](docs/database/data-dictionary.md).

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

**GitHub Pages (đang bật):** workflow `.github/workflows/pages.yml` tự build và xuất bản mỗi lần đẩy lên nhánh. Địa chỉ: https://konkonban.github.io/ARGOLET/. Tên miền riêng: thêm ở _Settings → Pages → Custom domain_ và tạo bản ghi DNS `CNAME` trỏ về `konkonban.github.io`.

### 2. Máy chủ đầy đủ (API + web, dữ liệu dùng chung) — dùng cho doanh nghiệp thật

```bash
docker build -t argolet .
```

Máy chủ cho doanh nghiệp thật (cơ sở dữ liệu bắt đầu trống, đồng hồ thật — mặc định khi `NODE_ENV=production`):

```bash
docker run -d -p 8080:8080 -e PEPPER="$(openssl rand -hex 32)" -e ARGOLET_SECRET_KEY="$(openssl rand -base64 32)" -e SMTP_URL="smtps://user:mat-khau@smtp.example.com:465" -e MAIL_FROM="ARGOLET <no-reply@ten-mien.vn>" -e DATABASE_URL="postgres://…" argolet
```

Thiếu `SMTP_URL` thì máy chủ từ chối khởi động (người dùng cần nhận mã xác minh qua email). Dùng PostgreSQL có sao lưu định kỳ; giữ `PEPPER` và `ARGOLET_SECRET_KEY` cố định và sao lưu an toàn. Người tạo tổ chức có quyền quản trị và kế toán trưởng; mời thêm người duyệt để tách người lập và người duyệt.

Máy chủ trải nghiệm có dữ liệu mẫu:

```bash
docker run -d -p 8080:8080 -e PEPPER="$(openssl rand -hex 32)" -e DEMO_SEED=true -v argolet-data:/data argolet
```

Image chạy bằng người dùng không phải root, phục vụ cả API lẫn web trên cổng 8080, lưu dữ liệu PGlite ở volume `/data` (hoặc trỏ `DATABASE_URL` tới PostgreSQL). Đặt sau reverse proxy có HTTPS (cookie phiên `Secure` khi `NODE_ENV=production`). Chạy được trên Render, Fly.io, Railway, Google Cloud Run, VPS…; gắn tên miền riêng tại nhà cung cấp đó.

| Biến môi trường                | Mặc định                                                                        | Ý nghĩa                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PEPPER`                       | —                                                                               | **Bắt buộc ở production**, ≥ 32 ký tự ngẫu nhiên (khóa bí mật để băm mã xác minh và tham chiếu lô bằng chứng)                                                                                                       |
| `DATABASE_URL`                 | `pglite:/data/pglite` (Docker)                                                  | `postgres://…` hoặc `pglite:<thư mục>` / `pglite:memory`                                                                                                                                                            |
| `PORT`, `HOST`                 | `8080`, `0.0.0.0`                                                               | Cổng lắng nghe                                                                                                                                                                                                      |
| `DEMO_SEED`                    | `false` khi `NODE_ENV=production`, `true` khi chạy thử                          | Tạo dữ liệu mẫu Minh An Commerce khi CSDL trống — chỉ dùng cho máy chủ trải nghiệm                                                                                                                                  |
| `DEMO_CLOCK`                   | theo `DEMO_SEED`                                                                | Đồng hồ bắt đầu từ 31/10/2026 09:40 để khớp dữ liệu mẫu                                                                                                                                                             |
| `SMTP_URL`                     | —                                                                               | Máy chủ gửi email, ví dụ `smtps://user:mat-khau@smtp.example.com:465` (Amazon SES, SendGrid, Mailgun, Google Workspace, Zoho…). Bật gửi mã xác minh, mã đặt lại mật khẩu, mã xác thực bổ sung và thư mời thành viên |
| `MAIL_FROM`                    | `ARGOLET <no-reply@argolet.local>`                                              | Người gửi hiển thị trong email                                                                                                                                                                                      |
| `EXPOSE_DEV_CODES`             | bật khi chưa cấu hình `SMTP_URL` và (không phải production hoặc có dữ liệu mẫu) | Hiển thị mã OTP trên giao diện thay vì gửi email — chỉ dùng cho thử nghiệm                                                                                                                                          |
| `ANTHROPIC_API_KEY`            | —                                                                               | Cho phép tổ chức chọn Claude làm trợ lý AI, và bật đọc chứng từ bằng mô hình thị giác (VLM) — đối chiếu từng trường với OCR                                                                                         |
| `ARGOLET_OCR`                  | `on`                                                                            | OCR tiếng Việt (Tesseract) trên máy chủ cho ảnh chứng từ; cùng VLM, trường nào hai bên đọc khác nhau phải được người kiểm tra                                                                                       |
| `ARGOLET_CLAUDE_MODEL`         | `claude-opus-5-5`                                                               | Model Claude cho trợ lý                                                                                                                                                                                             |
| `OPENAI_API_KEY`               | —                                                                               | Cho phép tổ chức chọn ChatGPT làm trợ lý AI (Responses API, `store: false`)                                                                                                                                         |
| `ARGOLET_OPENAI_MODEL`         | `gpt-6.1-sol`                                                                   | Model OpenAI cho trợ lý                                                                                                                                                                                             |
| `ARGOLET_SECRET_KEY`           | —                                                                               | 32 byte ngẫu nhiên (`openssl rand -base64 32`): mã hóa AES-256-GCM khóa API của đối tác (SePay, KiotViet). Không đặt thì tắt kết nối API đối tác. Giữ cố định và sao lưu an toàn                                    |
| `PUBLIC_BASE_URL`              | `http://localhost:<PORT>`                                                       | Địa chỉ công khai (liên kết trong thông báo)                                                                                                                                                                        |
| `CORS_ORIGINS`                 | —                                                                               | Danh sách origin được phép, phân tách bằng dấu phẩy (khi web chạy ở tên miền khác)                                                                                                                                  |
| `COOKIE_SECURE`, `TRUST_PROXY` | theo `NODE_ENV`                                                                 | Cookie `Secure`; tin cậy `X-Forwarded-*` từ reverse proxy                                                                                                                                                           |
| `WEB_DIST`                     | tự dò                                                                           | Thư mục web build mà API phục vụ                                                                                                                                                                                    |

**Trợ lý AI (Gen AI)** mặc định tắt cho mọi tổ chức. Quản trị viên vào _Cài đặt → Trợ lý AI_, dán **khóa API của tổ chức** (Claude: `sk-ant-…` từ console.anthropic.com; ChatGPT: `sk-…` từ platform.openai.com) rồi bấm _Kiểm tra và kết nối_: ARGOLET kiểm tra khóa trực tiếp với nhà cung cấp (Models API, không tốn lượt sinh văn bản), rồi niêm phong khóa (máy chủ: AES-256-GCM bằng `ARGOLET_SECRET_KEY`; điện thoại: iOS Keychain / Android Keystore), không hiển thị lại và có thể gỡ bất cứ lúc nào. Khóa đặt sẵn trên máy chủ (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) vẫn dùng được cho mọi tổ chức. Trước khi gửi, ARGOLET thay email, số điện thoại, mã số thuế, CCCD, số tài khoản và tên nhân sự bằng mã ẩn và khôi phục khi hiển thị; dữ liệu chỉ đi tới nhà cung cấp đã chọn; người hỏi được nhận diện bằng mã ẩn danh; nhật ký không lưu nội dung; mỗi người tối đa 20 câu hỏi / 10 phút. Claude dùng Messages API với _adaptive thinking_ và **server-side fallbacks** (`fallbacks: "default"`) trong cùng nhà cung cấp.

### 3. Ứng dụng Android / iOS

**Tải bản dùng thử:** mỗi lần mã nguồn mobile thay đổi, GitHub Actions (`.github/workflows/mobile.yml`) tự dựng và đăng lên trang Releases, mục [ARGOLET · ứng dụng di động (bản mới nhất)](https://github.com/KONKONBAN/ARGOLET/releases/tag/mobile-latest):

- **Android** — `ARGOLET-android.apk`: tải về điện thoại, mở tệp và cho phép “Cài ứng dụng không rõ nguồn” khi được hỏi;
- **iOS** — `ARGOLET-ios-simulator.zip`: chạy trên iOS Simulator (Xcode trên máy Mac: giải nén rồi kéo `ARGOLET.app` vào cửa sổ Simulator). Apple không cho cài tệp tự dựng lên iPhone thật: cài trên iPhone cần ký bằng tài khoản Apple Developer và phát hành qua TestFlight / App Store (lệnh EAS bên dưới).

Hai bản này chạy được ngay không cần máy chủ: dữ liệu của tổ chức lưu ngay trên điện thoại (bắt đầu trống, ngày giờ thật), kết nối đối tác (SePay, KiotViet) và trợ lý Claude / ChatGPT gọi thẳng từ điện thoại; khóa nằm trong kho khóa của máy. Muốn xem trước với dữ liệu mẫu, chạm _Dùng thử với dữ liệu mẫu_ ở màn đăng nhập (hoặc _Thêm → Dữ liệu_); _Quay lại dữ liệu của tôi_ để trở về. Nhiều người cùng làm việc thì nối máy chủ của tổ chức ở _Thêm → Dữ liệu → Máy chủ của tổ chức_.

**Chụp chứng từ:** điện thoại dùng trình quét tài liệu của hệ điều hành (iPhone: Apple VisionKit, như ứng dụng Ghi chú; Android: Google ML Kit Document Scanner, như Google Drive, cần Google Play services): tự nhận mép giấy, cắt thẳng, khử bóng, bộ lọc, nhiều trang. Máy không có thì mở màn quét riêng của ARGOLET (thiết kế riêng cho Android và iOS). Trên web: tự dò mép tờ chứng từ ngay khi ngắm, cắt thẳng phối cảnh, bộ lọc _Tài liệu / Màu gốc / Đen trắng_, xoay và cắt lại bằng bốn góc kéo được; đọc mã QR hóa đơn ngay khi chụp.

Ứng dụng React Native dựng bằng Expo / EAS Build thành bản cài đặt native (`.aab` cho Google Play, `.ipa` cho App Store). Có ba hồ sơ dựng (`apps/mobile/eas.json`):

- `production` — bản phát hành: **bắt buộc** `EXPO_PUBLIC_API_URL` dạng `https://` (dựng sẽ dừng nếu thiếu), chỉ làm việc với máy chủ ARGOLET và không bao giờ chuyển sang dữ liệu mẫu; mất kết nối thì báo và cho _Thử lại_;
- `preview`, `development` — bản cài trực tiếp (APK trên Releases): không có máy chủ thì chạy toàn bộ trên điện thoại với dữ liệu của tổ chức lưu trên máy; dữ liệu mẫu chỉ mở khi người dùng chọn _Dùng thử với dữ liệu mẫu_ và trở về như ban đầu sau khi đăng xuất.

```bash
npm i -g eas-cli
```

```bash
cd apps/mobile && eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://api.ten-mien-cua-ban.vn
```

```bash
cd apps/mobile && eas build --platform all --profile production
```

```bash
cd apps/mobile && eas submit --platform all --profile production
```

Mã gói `vn.argolet.app`; quyền: camera (không micro), không sao lưu dữ liệu ứng dụng lên đám mây; cần tài khoản Expo, Google Play Console và Apple Developer.

## Bảo mật (tóm tắt)

Mật khẩu Argon2id (máy chủ) · phiên HttpOnly + SameSite=Lax + CSRF header cho web, Bearer lưu SecureStore cho mobile · khóa tài khoản khi đăng nhập sai nhiều lần · TOTP/OTP · xác thực bổ sung (AAL2) cho phê duyệt từ 50 triệu đ · phân tách nhiệm vụ · phê duyệt gắn digest phiên bản · nhật ký kiểm toán · CSP/Helmet · giới hạn tần suất.
