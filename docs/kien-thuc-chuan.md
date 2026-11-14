# Chuẩn kiến thức tài chính – kế toán áp dụng trong ARGOLET

Tài liệu này ghi lại **công thức, quy ước và căn cứ** mà ARGOLET dùng, kèm nơi áp dụng trong sản phẩm và ví dụ kiểm chứng. Mọi phép tính nằm trong `packages/core` (số thập phân chính xác, không dùng số thực dấu phẩy động); tiền làm tròn đến đồng ở đúng chỗ ngân hàng/kế toán làm tròn.

Nguồn đối chiếu: bộ tài liệu môn học trong thư mục Drive "Tài liệu":

- Toán tài chính, chương 1–6;
- Ngân hàng thương mại C1–C9;
- Kế toán tài chính 1–2 theo Thông tư 99/2025/TT-BTC;
- Tài chính doanh nghiệp 1 (bài giảng, bài tập, đề thi);
- giáo trình Ross–Westerfield–Jordan, Berk–DeMarzo, Benninga;
- bộ Excel "Quantitative finance";
- bài mẫu FQA về đòn bẩy;
- tệp phân tích ROE/ROA;
- bảng hệ thống tài khoản TT99.

Văn bản pháp lý: TT14/2017/TT-NHNN (tính lãi), TT45/2013/TT-BTC (khấu hao), VAS 02 (hàng tồn kho), TT152/2025/TT-BTC (sổ hộ kinh doanh), TT99/2025/TT-BTC (chế độ kế toán doanh nghiệp).

## 1. Lãi đơn, lãi kép, lãi suất (`finmath.ts`)

| Nội dung                      | Công thức                                                         | Ghi chú                                                                    |
| ----------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Lãi đơn                       | I = V₀·n·i ; Vₙ = V₀(1 + n·i)                                     | i và n cùng đơn vị thời gian                                               |
| Lãi theo ngày                 | Dư nợ × số ngày × lãi suất năm / 365                              | TT14/2017/TT-NHNN; chuẩn quốc tế dùng 360                                  |
| Số ngày                       | Không tính ngày đầu, tính ngày cuối (15/01 → 16/07 = 182 ngày)    |                                                                            |
| Lãi suất trung bình (lãi đơn) | ī = Σnₖiₖ / Σnₖ                                                   |                                                                            |
| Lãi suất thực (lãi đơn)       | (Lãi + chi phí vay) / Vốn thực dùng / số năm                      | Vốn thực dùng = V₀ − phí (trả lãi sau) hoặc V₀ − phí − lãi (trả lãi trước) |
| Lãi kép                       | Vₙ = V₀(1 + i)ⁿ ; i = (Vₙ/V₀)^(1/n) − 1 ; n = ln(Vₙ/V₀)/ln(1 + i) |                                                                            |
| Ghép lãi m lần/năm            | Lãi suất hiệu dụng = (1 + j/m)^m − 1                              |                                                                            |
| Lãi suất trung bình (lãi kép) | [Π(1 + iₖ)^nₖ]^(1/Σnₖ) − 1                                        |                                                                            |
| Lãi suất thực (lãi kép)       | (Vₙ / (V₀ − phí))^(1/n) − 1                                       |                                                                            |

Kiểm chứng: 50 trđ × 182 ngày × 7,2%/360 = 1.820.000 đ; lãi suất trung bình 9,46%/năm; lãi suất thực 10,53%/năm (vay 200 trđ, 4 tháng, phí 600.000 đ); 400 trđ ghép 6 tháng với phí 0,5% → 4,587%/kỳ.

## 2. Chiết khấu thương phiếu, bao thanh toán

- Chiết khấu thương mại: e = V × n × i / 365 (trừ ngay); hiện giá a = V − e; lãi suất hiệu dụng = e/a × 365/n.
- Chiết khấu hợp lý: a′ = V / (1 + n × i / 365).
- AGIO = phí chiết khấu + hoa hồng ký hậu (V × n × i′/365) + hoa hồng chung (V × k) + phí khác.
  - Lãi suất chi phí chiết khấu = AGIO / V × 365/n.
  - Lãi suất chiết khấu thực tế = AGIO / (V − AGIO) × 365/n.
- Bao thanh toán:
  - ứng trước = giá trị khoản phải thu × tỷ lệ ứng trước;
  - phí = khoản phải thu × tỷ lệ phí;
  - lãi = số ứng trước × số ngày × lãi suất / 365;
  - phần còn lại trả cho bên bán.
- Lãi quá hạn: không vượt 150% lãi suất trong hạn.

Kiểm chứng (Toán tài chính chương 3, ví dụ 5): thương phiếu 300 trđ, 105 ngày, 9,6%, ký hậu 1%, hoa hồng chung 0,1%, phí 500.000 đ → phí chiết khấu 8.284.932 đ, AGIO 9.947.945 đ.

## 3. Chuỗi tiền tệ, vay vốn, thuê tài chính

**Chuỗi tiền tệ**

- Chuỗi đều: hiện giá a(1 − (1+i)⁻ⁿ)/i; giá trị tương lai a((1+i)ⁿ − 1)/i; nhân thêm (1 + i) nếu phát sinh đầu kỳ.
- Chuỗi vĩnh viễn: a/i; có tăng trưởng đều: a/(i − g).
- PMT, IPMT, PPMT, NPER, RATE, FV tính đúng như Excel/LibreOffice, gồm cả lựa chọn trả cuối kỳ (type 0) hay đầu kỳ (type 1).

**Lịch trả nợ** (`loanSchedule`), bốn phương thức:

- trả góp đều (kỳ khoản cố định);
- gốc đều, lãi tính trên dư nợ giảm dần (kỳ khoản giảm dần);
- lãi trả định kỳ, gốc trả cuối kỳ;
- gốc và lãi trả một lần khi đáo hạn.

Các tùy chọn và quy tắc làm tròn của lịch trả nợ:

- Có thể thêm thời gian ân hạn gốc.
- Cách tính lãi: theo kỳ (lãi suất năm × số tháng/12) hoặc theo ngày thực tế/365.
- Lãi mỗi kỳ làm tròn đến đồng; kỳ cuối điều chỉnh để tất toán đúng số dư.

**Thuê tài chính:** trả đầu kỳ, có giá trị còn lại (mua lại) cuối hợp đồng.

**Lãi suất thực của khoản vay có phí:** là lãi suất cân bằng số tiền thực nhận (vay − phí) với các kỳ trả nợ (`loanEffectiveCost`).

Kiểm chứng: vay 40 trđ, 10%/năm, 6 tháng → trả đều 6.862.456 đ/tháng, khớp hàm PMT của Excel. PPMT kỳ 3 = 6.638.395 đ, khớp công thức PPMTᵢ = PV × r/((1+r)ⁿ − 1) × (1+r)^(i−1).

## 4. Thẩm định dự án (`finance.ts`, màn Thẩm định dự án)

- NPV: dòng tiền cuối kỳ, CF₀ tại thời điểm 0.
- IRR: lãi suất làm NPV = 0; trả "không xác định" khi dòng tiền không đổi dấu.
- MIRR (như Excel): dòng âm chiết khấu theo lãi suất tài trợ, dòng dương ghép lãi theo lãi suất tái đầu tư. ARGOLET dùng suất chiết khấu cho cả hai.
- PI = hiện giá dòng tiền tương lai / vốn đầu tư ban đầu; PI ≥ 1 tương ứng NPV ≥ 0.
- Thời gian hoàn vốn giản đơn và có chiết khấu: nội suy tuyến tính trong năm hoàn vốn.
- EAA = NPV × r / (1 − (1+r)⁻ⁿ): so sánh dự án có thời gian khác nhau.
- DSCR = dòng tiền dành trả nợ / nghĩa vụ trả nợ năm.
- Giá trị thanh lý được cộng vào dòng tiền năm cuối.
- Dòng tiền hoạt động OCF = (Doanh thu − Chi phí bằng tiền − Khấu hao)(1 − t) + Khấu hao.
- CAPM: rₑ = r_f + β(r_m − r_f).
- WACC = wₑrₑ + wₚrₚ + w_d·r_d(1 − t).

Kiểm chứng (Ross ch.9, bộ Excel 9): dòng tiền −30.000; 13.700; 14.200; 13.400 với r = 11% → NPV = 3.665,35; MIRR = 15,35%.

## 5. Đòn bẩy và chỉ số tài chính (`ratios.ts`, Công cụ tính toán → Đòn bẩy & chỉ số)

| Chỉ số                        | Công thức                                                                                    | Ý nghĩa                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| DOL                           | (Doanh thu − Biến phí) / EBIT                                                                | Doanh thu thay đổi 1% → EBIT thay đổi DOL%            |
| DFL                           | EBIT / (EBIT − Lãi vay − Cổ tức ưu đãi/(1 − t))                                              | EBIT thay đổi 1% → lợi nhuận chủ sở hữu thay đổi DFL% |
| DTL                           | DOL × DFL = Số dư đảm phí / (EBIT − Lãi vay)                                                 |                                                       |
| Hòa vốn                       | Sản lượng = Định phí / (Giá − Biến phí đơn vị); Doanh thu = Định phí / tỷ lệ số dư đảm phí   |                                                       |
| Hệ số nợ                      | Nợ phải trả / Tổng tài sản                                                                   |                                                       |
| LEV                           | Nợ phải trả / Vốn chủ sở hữu                                                                 |                                                       |
| Hệ số nhân vốn chủ            | Tổng tài sản / Vốn chủ sở hữu                                                                |                                                       |
| Khả năng trả lãi              | EBIT / Lãi vay                                                                               |                                                       |
| DuPont                        | ROE = ROS × Vòng quay tổng tài sản × Hệ số nhân vốn chủ                                      |                                                       |
| Hiệu ứng đòn bẩy (MM mở rộng) | ROE = (1 + LEV)·ROA − LEV·Rd(1 − T), với ROA = EBIT(1 − T)/Tổng tài sản và Rd = Lãi vay / Nợ | Nợ làm tăng ROE khi ROA > Rd(1 − T)                   |

Chỉ số có mẫu số bằng 0 được báo "không xác định", không tự đặt giá trị. Kiểm chứng: EBIT 200, lãi vay 48, thuế 20%, tổng tài sản 1.000, vốn chủ 400 → ROE theo công thức MM bằng ROE tính từ báo cáo (30,4%).

## 6. Kế toán

- **Giá xuất kho:** bình quân gia quyền liên hoàn (VAS 02); không dùng LIFO.
- **Giá nhập kho hàng nhập khẩu:** trị giá tính thuế (CIF) + thuế nhập khẩu + chi phí liên quan; không gồm thuế GTGT được khấu trừ.
- **Khấu hao TSCĐ** (TT45/2013/TT-BTC):
  - Đường thẳng.
  - Số dư giảm dần có điều chỉnh: hệ số 1,5 (≤ 4 năm), 2,0 (> 4 đến 6 năm), 2,5 (> 6 năm). Chuyển sang chia đều khi mức khấu hao nhanh thấp hơn giá trị còn lại chia số năm còn lại.
  - Theo sản lượng.
  - Kiểm chứng: nguyên giá 50 trđ, 5 năm → 20 – 12 – 7,2 – 5,4 – 5,4 trđ.
- **Doanh thu và chi phí của doanh nghiệp** (TT133, TT99) ghi nhận trước thuế GTGT; thuế GTGT đầu vào/đầu ra trình bày riêng. Hộ kinh doanh không khấu trừ: tính cả thuế.
- **Báo cáo tài chính ARGOLET:** chỉ dùng chứng từ đã xác nhận.
  - Doanh thu thuần = doanh thu bán hàng − hoàn tiền − chiết khấu cho khách.
  - Chi phí theo yếu tố (nhóm của mẫu S2c-HKD) cộng phí nền tảng.
  - "Kết quả thu − chi" không phải lợi nhuận kế toán khi chưa có chứng từ lương, khấu hao…
- **Sổ hộ kinh doanh:** mẫu S1a, S2a–S2e-HKD theo TT152/2025/TT-BTC.
- **Thuế suất thuế TNDN** (gợi ý mặc định trong công cụ): phổ thông 20%; doanh nghiệp có doanh thu năm ≤ 3 tỷ đồng 15%, trên 3 đến 50 tỷ đồng 17%. Người dùng luôn nhập lại theo trường hợp của mình.

## 7. Kế toán kép tự động (`accounting.ts`, trang Sổ sách & chỉ số)

Doanh nghiệp (TT99 / TT133): mỗi chứng từ đã xác nhận thành một bút toán cân (Nợ = Có, bút toán không cân bị từ chối).

| Nghiệp vụ                        | Nợ                                                            | Có                                         |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| Bán hàng có hóa đơn / tại quầy   | 131 (tại quầy: 111)                                           | 511; 33311                                 |
| Đơn bán qua nền tảng             | 131 (doanh thu gộp)                                           | 511                                        |
| Hoàn tiền, chiết khấu cho khách  | 521 (TT99) · 511 (TT133)                                      | 131                                        |
| Phí nền tảng                     | 641 (TT99) · 6421 (TT133)                                     | 131                                        |
| Tiền về tài khoản / thu tiền mặt | 112 / 111                                                     | 131 (giải ngân 341, góp vốn 4111, lãi 515) |
| Mua nguyên liệu, hàng hóa        | 152 / 156; 1331                                               | 331 (hóa đơn có MST) · 111 (phiếu chi)     |
| Chi phí dịch vụ, quản lý         | 642 / 6422 (vận chuyển, nhiên liệu: 641 / 6421); 1331         | 331 · 111                                  |
| Lãi vay · tiền phạt              | 635 · 811                                                     | 111 / 331                                  |
| Lương · khấu hao                 | 642 / 6422                                                    | 334 · 214                                  |
| Chi tiền từ tài khoản (sao kê)   | 331 (trả nợ vay 341, lương 334, thuế 333x, phí ngân hàng 642) | 112                                        |

Cuối mỗi tháng: (1) giá vốn = tồn đầu kỳ + mua trong kỳ − tồn kiểm kê (chưa kiểm kê: hàng mua trong kỳ coi như đã dùng/bán), Nợ 632 / Có 152, 156; (2) khấu trừ thuế GTGT, Nợ 33311 / Có 1331 theo số nhỏ hơn; (3) tạm tính thuế TNDN trên lợi nhuận lũy kế từ đầu năm (lỗ thì giảm số đã tạm tính), Nợ 8211 (TT133: 821) / Có 3334; (4) kết chuyển 521 → 511, doanh thu và chi phí → 911, lãi/lỗ → 4212. Sang năm mới: 4212 → 4211.

Thuế suất TNDN tự động theo doanh thu năm (doanh thu thuần bình quân tháng × 12): ≤ 3 tỷ 15%, ≤ 50 tỷ 17%, còn lại 20% (Luật Thuế TNDN số 67/2025/QH15); kế toán có thể chọn lại.

**Báo cáo:** B02-DN (TT99: chỉ tiêu 25, 26) / B02-DNN (TT133: chỉ tiêu 24 chi phí quản lý kinh doanh); tình hình tài chính theo nhóm chỉ tiêu (tài sản = nợ phải trả + vốn chủ, kiểm tra tự động); bảng cân đối tài khoản; Sổ Nhật ký chung S03a.

**Chỉ số** (bình quân đầu kỳ – cuối kỳ cho vòng quay và tỷ suất; số ngày = số ngày của kỳ):

| Nhóm                | Chỉ số                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Khả năng thanh toán | Hiện hành = TS ngắn hạn / Nợ phải trả; nhanh = (TS ngắn hạn − hàng tồn kho) / Nợ; bằng tiền = Tiền / Nợ; lãi vay = EBIT / Lãi vay                                                                              |
| Cơ cấu vốn, đòn bẩy | Hệ số nợ = Nợ / Tổng TS; Nợ / Vốn chủ; Hệ số nhân = TS bq / VCSH bq; DOL = SDĐP / EBIT; DFL = EBIT / (EBIT − Lãi vay); DTL = SDĐP / (EBIT − Lãi vay)                                                           |
| Hiệu quả hoạt động  | Vòng quay TS = DTT / TS bq; vòng quay phải thu = DTT / Phải thu bq; kỳ thu tiền = số ngày / vòng quay; vòng quay HTK = Giá vốn / HTK bq; số ngày tồn kho; số ngày trả tiền = số ngày / (Giá vốn / Phải trả bq) |
| Khả năng sinh lời   | Lợi nhuận gộp / DTT; LN thuần HĐKD / DTT; ROS = LNST / DTT; ROA = LNST / TS bq; ROE = LNST / VCSH bq; BEP = EBIT / TS bq (ROE = ROS × vòng quay TS × hệ số nhân)                                               |

EBIT = lợi nhuận trước thuế + chi phí lãi vay. Biến phí = giá vốn + phí nền tảng, vận chuyển, nhiên liệu, hoa hồng; định phí = SDĐP − EBIT. Kiểm chứng (`accounting.test.ts`): tháng mẫu doanh thu thuần 169, giá vốn 80, LNTT 81, thuế 16,2, LNST 64,8; tài sản 531 = nợ 126,2 + vốn chủ 404,8 (triệu đồng).

**Thẩm định dự án và kịch bản lấy số liệu từ sổ:** dòng tiền thuần/năm = (LNST + khấu hao) bình quân tháng × 12; suất chiết khấu = WACC với chi phí vốn chủ = ROE năm hóa và chi phí nợ = lãi vay năm hóa / nợ vay bình quân × (1 − t); trả nợ/năm = lãi vay + gốc đã trả, năm hóa; kịch bản thận trọng / tích cực = bình quân ∓ một độ lệch chuẩn của kết quả tháng.

**Lưu vết tính toán (CalcRun):** mỗi lần thẩm định dự án, xuất sổ kế toán & báo cáo tài chính (`books_statements`) hay xuất báo cáo tài chính theo tháng (`finance_report`) đều ghi một CalcRun: dấu vân tay dữ liệu nguồn (SHA-256 của các bút toán nguồn / bản ghi đã xác nhận), thiết lập (chế độ kế toán, kỳ, số dư đầu kỳ, kiểm kê, thuế suất), phiên bản quy tắc (`ledger-rules-2026.11`, `report-rules-2026.11`), phiên bản Finance Engine và kết quả chính. Cùng dữ liệu và thiết lập cho cùng mã kiểm tra; khách hàng thấy danh sách ở "Lịch sử tính toán" (thời điểm, phép tính, phiên bản, mã kiểm tra), không thấy công thức.

## 8. Đọc chứng từ: OCR + VLM

Ảnh và bản quét được đọc hai lần, độc lập: OCR (Tesseract, mô hình tiếng Việt, trả về chữ in và vị trí) và VLM (mô hình thị giác – ngôn ngữ, hiểu bố cục). Trường hai bên đọc giống nhau, hoặc giá trị VLM có in trên ảnh theo OCR → độ tin cậy ≥ 0,95. Giá trị VLM không có trong chữ OCR đọc được, hoặc hai bên đọc khác → độ tin cậy ≤ 0,5 và màn Kiểm tra chứng từ hiện cả hai cách đọc để người kiểm tra đối chiếu với ảnh gốc. Chỉ có OCR → tối đa 0,7 (luôn cần người kiểm tra). QR hóa đơn điện tử (QĐ 1450) đúng CRC được dùng cho trường còn thiếu. Kiểm chứng: `ocrfields.test.ts`, `apps/api/test/ocr.test.ts` (ảnh thật, VLM đọc nhầm 1.480.000 thay vì 1.840.000 bị chặn lại).
