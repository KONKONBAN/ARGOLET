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
