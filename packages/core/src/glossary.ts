/**
 * Từ điển nghiệp vụ ARGOLET: accounting and tax terms the assistant can explain without an AI
 * provider, and that an AI provider receives as context when a question is about them. Written for
 * ARGOLET in plain words; legal references are given so a reader can check the text in force.
 */
import type { KnowledgePassage } from './knowledge';

const t = (id: string, title: string, content: string): KnowledgePassage => ({
  id: `gl_${id}`,
  title,
  content,
});

export const GLOSSARY: KnowledgePassage[] = [
  t(
    'hoa-don-dien-tu',
    'Hóa đơn điện tử',
    'Hóa đơn lập bằng phương tiện điện tử theo Nghị định 123/2020/NĐ-CP (sửa đổi bởi Nghị định 70/2025/NĐ-CP). Có hai loại: có mã của cơ quan thuế (mã CQT cấp cho từng hóa đơn) và không có mã. Bản thể hiện thường in mã QR chứa mã số thuế người bán, ký hiệu, số, ngày lập và tổng tiền để tra cứu trên hoadondientu.gdt.gov.vn.',
  ),
  t(
    'ky-hieu-hoa-don',
    'Ký hiệu hóa đơn',
    'Chuỗi như 1C26TAA: chữ số đầu là loại hóa đơn (1 là hóa đơn giá trị gia tăng, 2 là hóa đơn bán hàng), chữ C là có mã của cơ quan thuế (K là không có mã), 26 là hai số cuối năm lập, chữ tiếp theo cho biết hình thức (T là doanh nghiệp đăng ký sử dụng với cơ quan thuế), hai chữ cuối do người bán tự đặt. Ký hiệu cùng mã số thuế người bán và số hóa đơn xác định duy nhất một hóa đơn.',
  ),
  t(
    'thue-gtgt',
    'Thuế giá trị gia tăng (GTGT, VAT)',
    'Thuế tính trên phần giá trị tăng thêm của hàng hóa, dịch vụ. Thuế suất 0%, 5% và 10%; mức 8% là mức giảm áp dụng có thời hạn cho một số nhóm hàng hóa, dịch vụ theo nghị quyết của Quốc hội. Trên hóa đơn: cộng tiền hàng cộng tiền thuế GTGT bằng tổng tiền thanh toán.',
  ),
  t(
    'khau-tru-gtgt',
    'Khấu trừ thuế GTGT đầu vào',
    'Doanh nghiệp nộp thuế theo phương pháp khấu trừ được trừ thuế GTGT trên hóa đơn mua vào khỏi thuế GTGT đầu ra phải nộp, khi có hóa đơn GTGT hợp pháp và chứng từ thanh toán không dùng tiền mặt đối với khoản mua đạt ngưỡng giá trị luật quy định (từ 01/7/2025 là từ 5 triệu đồng trở lên theo Luật Thuế GTGT 2024). Thuế đầu vào ghi vào tài khoản 1331.',
  ),
  t(
    'thue-dau-ra',
    'Thuế GTGT đầu ra',
    'Thuế GTGT tính trên hàng hóa, dịch vụ bán ra, ghi trên hóa đơn bán ra và vào tài khoản 33311. Số phải nộp trong kỳ bằng thuế đầu ra trừ thuế đầu vào được khấu trừ.',
  ),
  t(
    'thue-tndn',
    'Thuế thu nhập doanh nghiệp (TNDN)',
    'Thuế tính trên thu nhập chịu thuế của doanh nghiệp. Thuế suất phổ thông 20%; doanh nghiệp có doanh thu nhỏ có thể áp dụng 15% hoặc 17% theo Luật Thuế TNDN 2025. Trong năm doanh nghiệp tạm nộp theo quý và quyết toán khi kết thúc năm.',
  ),
  t(
    'ho-kinh-doanh',
    'Hộ kinh doanh và sổ sách',
    'Hộ kinh doanh, cá nhân kinh doanh ghi sổ theo Thông tư 152/2025/TT-BTC (các mẫu S1-HKD đến S3-HKD tùy cách nộp thuế). Từ năm 2026 hộ kinh doanh không còn nộp thuế khoán mà tự khai theo doanh thu thực tế. Hộ kinh doanh không khấu trừ thuế GTGT đầu vào: chi phí ghi theo tổng tiền thanh toán.',
  ),
  t(
    'chung-tu-ke-toan',
    'Chứng từ kế toán',
    'Giấy tờ hoặc dữ liệu điện tử phản ánh nghiệp vụ kinh tế đã phát sinh và hoàn thành, là căn cứ ghi sổ theo Luật Kế toán 2015: hóa đơn, phiếu thu, phiếu chi, giấy báo ngân hàng, phiếu nhập, phiếu xuất. Chứng từ phải đủ nội dung bắt buộc và được lưu trữ theo thời hạn luật định.',
  ),
  t(
    'ghi-so-kep',
    'Ghi sổ kép (bút toán Nợ, Có)',
    'Mỗi nghiệp vụ được ghi đồng thời vào ít nhất hai tài khoản: một bên Nợ và một bên Có với số tiền bằng nhau, nên tổng phát sinh Nợ luôn bằng tổng phát sinh Có. Ví dụ mua hàng chưa trả tiền: Nợ 156 (hàng hóa), Nợ 1331 (thuế đầu vào), Có 331 (phải trả người bán).',
  ),
  t(
    'he-thong-tai-khoan',
    'Hệ thống tài khoản kế toán doanh nghiệp',
    'Danh mục tài khoản theo chế độ kế toán doanh nghiệp (Thông tư 99/2025/TT-BTC áp dụng từ năm tài chính 2026, thay Thông tư 200/2014/TT-BTC). Một số tài khoản thường gặp: 111 tiền mặt, 131 phải thu khách hàng, 152 nguyên liệu vật liệu, 156 hàng hóa, 1331 thuế GTGT được khấu trừ, 331 phải trả người bán, 33311 thuế GTGT đầu ra, 511 doanh thu, 632 giá vốn hàng bán, 642 chi phí quản lý doanh nghiệp, 911 xác định kết quả kinh doanh.',
  ),
  t(
    'gia-von',
    'Giá vốn hàng bán',
    'Chi phí của hàng hóa đã bán hoặc dịch vụ đã cung cấp trong kỳ (tài khoản 632). Với hàng tồn kho có thể tính theo bình quân gia quyền, nhập trước xuất trước hoặc thực tế đích danh, và phải áp dụng nhất quán.',
  ),
  t(
    'doanh-thu-thuan',
    'Doanh thu thuần',
    'Doanh thu bán hàng và cung cấp dịch vụ sau khi trừ các khoản giảm trừ: chiết khấu thương mại, giảm giá hàng bán và hàng bán bị trả lại.',
  ),
  t(
    'dong-tien-thuan',
    'Dòng tiền thuần',
    'Tiền thu vào trừ tiền chi ra trong một kỳ. Khác lợi nhuận vì tính theo lúc tiền thực sự thu, chi: doanh thu bán chịu chưa thu chưa làm tăng dòng tiền.',
  ),
  t(
    'doi-soat',
    'Đối soát',
    'So khớp các nguồn dữ liệu về cùng giao dịch: đơn hàng với tiền về tài khoản ngân hàng, hóa đơn với phiếu nhập kho, sao kê với sổ quỹ. Phần chênh lệch (thiếu tiền, phí sàn, hoàn tiền) phải được giải thích trước khi chốt kỳ.',
  ),
  t(
    'chot-ky',
    'Chốt kỳ (khóa sổ)',
    'Kết thúc ghi nhận cho một kỳ kế toán sau khi đã kiểm tra chứng từ, đối soát và kết chuyển. Số liệu kỳ đã chốt không được sửa trực tiếp; sai sót phát hiện sau được điều chỉnh bằng bút toán ở kỳ hiện tại.',
  ),
  t(
    'tai-san-co-dinh',
    'Tài sản cố định và khấu hao',
    'Tài sản dùng trên một năm và có nguyên giá từ 30 triệu đồng trở lên (theo quy định về quản lý, khấu hao tài sản cố định). Giá trị được phân bổ dần vào chi phí qua khấu hao; phương pháp đường thẳng chia đều nguyên giá cho số năm sử dụng.',
  ),
  t(
    'cong-no',
    'Công nợ phải thu, phải trả',
    'Phải thu (tài khoản 131) là tiền khách hàng còn nợ; phải trả (tài khoản 331) là tiền còn nợ nhà cung cấp. Theo dõi theo từng đối tượng và tuổi nợ để biết khoản nào sắp hoặc đã quá hạn.',
  ),
  t(
    'npv',
    'NPV (giá trị hiện tại thuần)',
    'Tổng các dòng tiền tương lai của dự án quy về hiện tại theo suất chiết khấu, trừ vốn đầu tư ban đầu. NPV dương nghĩa là dự án tạo thêm giá trị so với suất sinh lợi yêu cầu.',
  ),
  t(
    'irr',
    'IRR và MIRR',
    'IRR là suất chiết khấu làm NPV bằng 0. MIRR điều chỉnh giả định tái đầu tư của IRR: dòng tiền dương được tái đầu tư theo suất tái đầu tư, dòng tiền âm được tài trợ theo chi phí vốn, nên phản ánh thực tế hơn khi dòng tiền đổi dấu nhiều lần.',
  ),
  t(
    'hoan-von',
    'Thời gian hoàn vốn',
    'Số năm để dòng tiền tích lũy bù đủ vốn đầu tư. Hoàn vốn có chiết khấu dùng dòng tiền đã quy về hiện tại nên luôn dài hơn hoàn vốn giản đơn.',
  ),
  t(
    'dscr',
    'DSCR (hệ số khả năng trả nợ)',
    'Dòng tiền dành cho trả nợ chia cho nghĩa vụ trả gốc và lãi trong kỳ. Ngân hàng thường yêu cầu DSCR từ khoảng 1,2 trở lên.',
  ),
  t(
    'wacc',
    'WACC (chi phí vốn bình quân)',
    'Chi phí vốn bình quân gia quyền giữa vốn chủ sở hữu và vốn vay (chi phí lãi vay tính sau thuế vì lãi vay được trừ khi tính thuế TNDN). Thường dùng làm suất chiết khấu khi thẩm định dự án.',
  ),
  t(
    'von-luu-dong',
    'Vốn lưu động',
    'Tài sản ngắn hạn trừ nợ ngắn hạn. Vòng quay vốn lưu động phụ thuộc số ngày thu tiền khách hàng, số ngày tồn kho và số ngày trả tiền nhà cung cấp.',
  ),
  t(
    'phi-san',
    'Phí nền tảng, phí sàn thương mại điện tử',
    'Khoản sàn hoặc ứng dụng giao hàng giữ lại trước khi chuyển tiền cho người bán (hoa hồng, phí thanh toán, phí vận chuyển). Doanh thu ghi theo giá bán; phí ghi vào chi phí, nên tiền về tài khoản thường nhỏ hơn doanh thu đơn hàng.',
  ),
  t(
    'ma-so-thue',
    'Mã số thuế',
    'Dãy 10 chữ số cấp cho doanh nghiệp, tổ chức; chi nhánh và đơn vị phụ thuộc có thêm 3 chữ số sau dấu gạch (ví dụ 0101234567-001). Từ 01/7/2025 số định danh cá nhân được dùng thay mã số thuế của cá nhân.',
  ),
  t(
    'hoa-don-dieu-chinh',
    'Hóa đơn điều chỉnh, thay thế',
    'Khi hóa đơn đã lập có sai sót, người bán lập hóa đơn điều chỉnh (tăng hoặc giảm số tiền, sửa thông tin) hoặc hóa đơn thay thế, có ghi rõ thông tin hóa đơn bị điều chỉnh hoặc thay thế, thay vì sửa hóa đơn cũ.',
  ),
  t(
    'sai-ky',
    'Ghi nhận đúng kỳ',
    'Doanh thu và chi phí được ghi vào kỳ phát sinh nghiệp vụ, không theo ngày thu, chi tiền. Chứng từ của kỳ đã chốt nhận muộn được ghi vào kỳ hiện tại kèm giải thích.',
  ),
];
