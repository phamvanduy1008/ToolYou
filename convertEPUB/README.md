# Tách chương EPUB

Tool Node.js đọc ZIP EPUB, đọc thứ tự nội dung từ OPF/spine và tách theo điểm neo của mục lục. Một chương có thể nằm trong nhiều HTML; một HTML có thể chứa nhiều chương. Không dùng OCR và không sửa nội dung truyện.

## Chạy trong PowerShell

```powershell
cd D:\Code\TTS\cawl\convertEPUB
npm.cmd install
node .\extract.js
```

Sửa `INPUT_FILE` và `OUTPUT_DIR` ở đầu `extract.js` để chọn đường dẫn. Mặc định input là EPUB Vô Địch Kiếm Vực trong `convertEPUB/Epub`, output là `D:\Code\TTS\cawl\convertEPUB\output`.

Hoặc truyền trực tiếp đường dẫn EPUB:

```powershell
node .\extract.js "D:\duong-dan\truyen.epub" --out ".\ket-qua" --group 50
```

Kết quả mặc định nằm trong `convertEPUB/output/<tên-truyện-không-dấu>` để các truyện không dùng chung thư mục:

```text
output/cau-ma-nhi-can/
  chapters/
    chuong-1.txt
    chuong-2.txt
    ...
  merge/
    chuong-1-50.txt
    chuong-51-100.txt
    ...
    chuong-2801-2806.txt
  report.json
```

Mỗi TXT dùng UTF-8, chỉ chứa nội dung truyện và giữ đoạn văn, giải mã HTML entities. Bỏ tiêu đề chương (kể cả tiêu đề lặp trong thân), nguồn ebook, thông tin dịch/biên tập, URL, phần điều hướng và dòng phân cách. Các câu quảng bá nhận diện được như “Truyện được copy tại Truyenyy.com” được xóa riêng, giữ phần truyện cùng đoạn. `--keep-credits` không còn hỗ trợ. Tên truyện, tên chương và vị trí nguồn chỉ lưu trong `report.json`. File gộp cuối chứa số chương còn lại nếu không đủ 50.

## Kiểm tra và giới hạn

Đã chạy trên EPUB Vô Địch Kiếm Vực trong thư mục này: xuất 2.806 file chương và 57 file gộp. Đối chiếu độc lập đủ 232.548 đoạn `<p>` không rỗng trong nguồn với TXT đầu ra, không thiếu đoạn. Các chương 112, 180, 181, 182 có phần thân rỗng ngay trong EPUB gốc; kết quả giữ tiêu đề và báo cáo các số này.

- Chọn mục lục có nhiều chương nhất giữa `.chapter_link`, EPUB navigation và NCX. Với Vô Địch Kiếm Vực, mục lục nội dung có 2.806 chương, NCX chỉ có 50.
- Kiểm tra số chương trùng, điểm neo thiếu/trùng, thứ tự nội dung và số chương bị thiếu trước khi xuất. Chương chỉ có tiêu đề trong nguồn được giữ nguyên số và ghi vào `emptyChapters` trong báo cáo.
- Nếu nội dung có `.chapter_title`, yêu cầu toàn bộ tiêu đề khớp mục lục.
- Đọc lại từng file gộp và so sánh chính xác với các file chương đã ghi. Báo cáo lưu vị trí nguồn, tên file và kết quả kiểm tra.
- Không ghi đè thư mục có dữ liệu: khi chạy lại, chọn `--out` mới. Nếu ghi file bị lỗi giữa chừng, kết quả có thể chưa đầy đủ; chỉ coi lần chạy thành công khi có `report.json` với `outputVerified: true`.
- Tool hướng tới EPUB văn bản có mục lục với nhãn `Chương <số>` hoặc `Chương thứ <số>`. EPUB ảnh, thiếu mục lục hay cấu trúc khác cần điều chỉnh; tool sẽ báo lỗi thay vì đoán ranh giới.
- Kiểm tra cấu trúc không chứng minh bản ebook gốc không thiếu câu hoặc có lỗi dịch.

```powershell
node --test
node .\extract.js --help
```

## Numbering fallback

When source chapter numbers repeat, skip numbers or decrease, output filenames use TOC order (`numberingMode: toc-order`). `sourceNumber` and `title` in report.json preserve the original labels. No missing narrative is invented. Missing anchors and duplicate anchor references still stop extraction.

Cau Ma: 1,485 TOC entries extracted into 1,485 chapter files and 30 merged files. Source labels contain duplicates 76, 497, 1283; missing labels 77, 495, 1126, 1317; an anomalous label 13317. Output numbers represent reading order.
