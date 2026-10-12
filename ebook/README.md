# DTV EPUB Collector

Công cụ quét **một danh mục mỗi lần chạy** trên DTV và tải toàn bộ truyện có trạng thái metadata `Hoàn Thành` cùng link EPUB công khai. Công cụ không crawl từng chương, không tải PDF/MOBI/AZW3 và không vượt qua đăng nhập, captcha hay giới hạn truy cập.

## Cấu hình

```python
INPUT_URL = "https://dtv-ebook.com.vn/huyen-ao-497.html"
OUTPUT_DIR = r"D:\Code\TTS\cawl\ebook\downloads"
ALLOW_CV_FULL = False
```

`INPUT_URL` nhận một trong hai URL: `tien-hiep-488.html` hoặc `huyen-ao-497.html`. Đổi URL rồi chạy lại để xử lý danh mục còn lại. `ALLOW_CV_FULL=False` nghĩa là `CV FULL`, `Chương xxx` và `Dịch xxx` không được coi là `Hoàn Thành`.

EPUB mới được lưu trong thư mục của danh mục tương ứng dưới `OUTPUT_DIR`, rồi chia theo bốn loại bản dịch:

```text
downloads/
├── Tiên Hiệp/
│   ├── Dịch/
│   ├── AI/
│   ├── CV/
│   └── Chưa xác định/
└── Huyền Ảo/
    ├── Dịch/
    ├── AI/
    ├── CV/
    └── Chưa xác định/
```

Bản `MIXED` vẫn được ghi đúng loại trong CSV nhưng lưu ở `Chưa xác định/`, để đầu ra chỉ có bốn thư mục. Khi cùng tác phẩm có nhiều bản, ưu tiên **Dịch > MIXED > AI > CV > Chưa xác định**.

Sau khi quét xong từng trang, chương trình tải bản tốt nhất đã thấy. Nếu trang sau có bản ưu tiên cao hơn, EPUB mới được tải và xác thực thành công rồi mới xóa EPUB cũ trong đúng thư mục danh mục và cập nhật `data/books.csv`. Nếu tải bản mới lỗi, EPUB cũ được giữ nguyên. File cũ ngoài thư mục danh mục hoặc đang được truyện khác dùng không bị xóa tự động.

`downloads/danh_sach_epub.json` là danh sách EPUB chung cho mọi thể loại. Mỗi lần chạy, chương trình quét lại file thật trên đĩa để tạo chỉ mục trước khi tải, rồi cập nhật nó sau mỗi lần tải hoặc xóa. Việc so trùng dựa trên tên truyện và tác giả đã chuẩn hóa; file trong `50_ChuongDau/` hoặc `Con_Lai/` được đánh dấu là một phần truyện và **không** chặn tải EPUB đầy đủ. Nếu đã có bản đầy đủ ở Tiên Hiệp thì lượt tải Huyền Ảo sẽ bỏ qua. Với các thể loại khác, bản cùng hoặc cao ưu tiên hơn được giữ; bản ưu tiên thấp hơn chỉ bị thay sau khi bản mới tải thành công. `downloads/Tiên Hiệp/danh_sach_epub.json` là ảnh chụp danh sách riêng trước đây, không dùng làm chỉ mục tải.

Đầu mỗi lần chạy có tải, chương trình cũng kiểm tra các EPUB **đầy đủ** đã tồn tại ở Huyền Ảo; nếu trùng tên truyện và tác giả với một EPUB đầy đủ, hợp lệ ở Tiên Hiệp thì xóa bản Huyền Ảo và cập nhật CSV/chỉ mục. Chế độ `--scan-only` không xóa file.

## Chạy

Yêu cầu Python 3.11 trở lên. Trên PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# Quét danh mục trong config.py và tải mọi EPUB Hoàn Thành.
.\.venv\Scripts\python.exe main.py

# Chỉ tải từ dữ liệu đã quét trong data/books.csv, không quét lại website.
.\.venv\Scripts\python.exe main.py --from-csv

# Tiếp tục sau gián đoạn: quét lại danh mục, tái dùng metadata đã lưu.
.\.venv\Scripts\python.exe main.py --resume

# Chỉ quét metadata, không tải EPUB.
.\.venv\Scripts\python.exe main.py --scan-only

# Nhập dữ liệu đã xuất bằng Chrome rồi tải EPUB bằng pipeline hiện tại.
.\.venv\Scripts\python.exe main.py --browser-export .\dtv-xuyen-khong-export.json

```

Khi website đã cho phép bạn crawl nhưng chặn HTTP client, mở trang danh mục bằng
Chrome, mở DevTools Console, chạy toàn bộ `scripts/dtv_browser_export.js` và chờ
trình duyệt tải file JSON. Truyền file JSON đó cho `--browser-export`. Script chỉ
dùng phiên của tab hiện tại; không đọc mật khẩu hay hồ sơ Chrome.

Hoặc dùng extension không cần DevTools: mở `chrome://extensions`, bật Developer
mode, chọn Load unpacked và trỏ tới thư mục `browser_extension/`. Mở trang danh
mục DTV, nhấn biểu tượng DTV EPUB Exporter rồi chọn Bắt đầu. Extension dùng một
tab chuyên dụng và tự tải `dtv-browser-export.json` khi hoàn tất. Nút **Xuất phần
đã lấy** không xóa phiên nên vẫn có thể bấm **Tiếp tục**. Nếu chỉ còn file JSON,
chọn **Nhập JSON để tiếp tục**; extension sẽ nạp dữ liệu cũ, bỏ qua các truyện đã
có và quét tiếp phần còn thiếu. Sau đó chạy:

```powershell
.\.venv\Scripts\python.exe main.py --browser-export "C:\Users\ASUS\Downloads\dtv-browser-export.json"
```

`--max-pages N` và `--max-books N` dùng để chạy thử trên một phần danh mục.

Mỗi trang in bảng truyện trước khi mở từng trang chi tiết. `[DETAIL x/n]` cho biết truyện đang kiểm tra, `[RETRY]` cho biết request đang thử lại, `[PAGE DONE]` và `[BOOK]` cho biết giai đoạn tải. Nếu lệnh cũ còn chạy, nhấn `Ctrl+C` ở cửa sổ đó trước khi chạy phiên bản mới; không chạy song song hai tiến trình cùng ghi `data/books.csv`.

`data/books.csv` là chỉ mục tổng hợp: ghi mọi truyện đã quét, loại bản dịch, EPUB URL, trạng thái tải và đường dẫn file. Khi chạy lại, EPUB hợp lệ đã tải được bỏ qua, kể cả khi bạn đã chuyển file sang thư mục khác trong `downloads/`; công cụ sẽ đối chiếu và cập nhật đường dẫn. Không tạo JSON riêng cho từng EPUB.

`data/top50.csv` là báo cáo cũ từ phiên bản có chấm điểm, **không còn được đọc hoặc cập nhật**. Bạn có thể giữ lại để tham khảo.
