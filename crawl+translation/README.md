# Novel Crawler + Gemini Translator

Công cụ Python 3.11+ crawl tuần tự nội dung mà bạn có quyền truy cập, lưu JSON để resume, dịch bằng Gemini theo glossary và xuất TXT. Công cụ không vượt CAPTCHA, paywall, đăng nhập hay cơ chế chống bot; luôn kiểm tra `robots.txt`.


python main.py crawl --start 1 --end 10

python main.py translate --start 1 --end 10
python main.py audit


## Cài đặt

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Điền `GEMINI_API_KEY` trong `.env`. Model chỉ cấu hình qua `GEMINI_MODEL`.
`GEMINI_REPAIR_MODEL` là model mạnh hơn, chỉ được gọi ở bước cuối cho một segment
nhỏ vẫn lỗi sau khi đã thử lại bằng model nhanh.
`GEMINI_REQUESTS_PER_MINUTE=12` giãn đều các lần gọi Gemini (mỗi 5 giây),
chừa biên an toàn dưới giới hạn free tier 15 RPM. Khi API vẫn trả 429, chương
hiện tại sẽ tự chờ theo `RetryInfo` rồi thử lại, không bỏ qua checkpoint.
`TRANSLATION_WORKERS=2` cho phép hai chunk chờ API đồng thời nhưng vẫn dùng chung
rate limiter. `GEMINI_REQUEST_TIMEOUT=300` giới hạn thời gian của một request.

## Sử dụng

```bat
python main.py crawl --url "https://www.97du.cc/105/105308/" --start 1 --end 10
python main.py translate --start 1 --end 10
python main.py translate --start 1 --end 100 --continue-on-error
python main.py audit --start 1 --end 100
python main.py export --format txt --output output/book.txt
python main.py status
```

### Safe crawl với manifest

Với sách đã có cấu hình trong `data/books`, dùng luồng catalogue → staging → audit → commit:

```bat
python main.py crawl-catalogue --book Thai_Hu_Chi_Ton --url "https://www.bqgns.com/book/52413"
python main.py crawl --book Thai_Hu_Chi_Ton --start 301 --end 350 --staging --continue-on-error
python main.py crawl-audit --book Thai_Hu_Chi_Ton --start 301 --end 350 --reference qidian
python main.py crawl-commit --book Thai_Hu_Chi_Ton --start 301 --end 350
```

Raw chỉ được ghi sau khi số chương/H1,
tiêu đề, trang con, URL, marker lỗi, tỷ lệ chữ Hán, SHA-256 và near-duplicate
fingerprint đều hợp lệ. HTML và nội dung trung gian nằm trong `data/staging`;
provenance nằm trong `data/manifests/<book>`.

Khi có nhiều truyện trong `data/raw`, có thể chỉ định thư mục truyện cần dịch:

```bat
python main.py translate --book Thai_Hu_Chi_Ton --start 240 --end 500 --version v2
```

Nếu truyện đang active không có chương trong khoảng yêu cầu và chỉ một thư mục raw
khác có dữ liệu phù hợp, lệnh `translate` sẽ tự chọn thư mục đó.

Có thể đặt mặc định trong `.env`: `BOOK_URL`, `CRAWL_START` và `CRAWL_COUNT`.
Khi chạy `python main.py crawl` không có argument, CLI sẽ dùng các giá trị này.

Chạy lại cùng lệnh sẽ bỏ qua JSON hợp lệ đã hoàn thành. Dùng `--force` để làm lại. Bản dịch checkpoint từng chunk nằm trong `data/translated/.work/` và được tái sử dụng sau khi tiến trình dừng giữa chừng.
Mọi checkpoint đều có fingerprint theo nguồn, glossary, prompt và model; checkpoint
cũ không còn khớp sẽ được dịch lại thay vì ghép nhầm.

Raw và bản dịch nằm trong `data/raw/<tên truyện>/` và
`data/translated/<tên truyện>/`. Mỗi chương là một file TXT UTF-8; file dịch chỉ
chứa nội dung tiếng Việt đã định dạng theo đoạn.
Tên file chương dùng số tự nhiên, ví dụ `1.txt`, `2.txt`, `123.txt`.
Glossary nằm tại `data/glossary.json` theo dạng `{"江凡": "Phương Thần"}`.
Trước khi dịch mỗi chương mới, chương trình chỉ tự nhận diện tên người chưa có,
lưu chúng vào file này rồi dùng ngay cho chương hiện tại và các chương sau. Địa danh,
tông môn, công pháp, cảnh giới và các thuật ngữ khác không được tự thêm. Mục đã tồn
tại không bao giờ bị model tự ghi đè; bạn vẫn có thể sửa thủ công nếu muốn chốt một
cách dịch khác.

Nếu glossary đã hoàn thiện, bỏ request nhận diện tên của từng chương để tiết kiệm
thời gian và quota:

```bat
python main.py translate --start 1 --end 100 --skip-glossary-discovery --continue-on-error
```

Chạy `python main.py audit` để rà toàn bộ bản dịch. Lệnh phát hiện chữ Hán còn sót,
văn convert, mật độ phiên âm bất thường và tên gần giống nhưng không khớp glossary;
báo cáo chi tiết được lưu tại `logs/translation_audit.txt`.

## Pipeline v2

Không cần quét `glossary_candidates` trước. Khi dịch, mỗi chương được nhận diện tên
người trước, cập nhật `data/glossary.json`, rồi mới dịch vào thư mục riêng
`Thai_Hu_Chi_Ton_v2`:

```bat
python main.py translate --start 1 --end 2509 --version v2
python main.py audit --version v2 --output logs/translation_audit_v2.txt
python main.py export --version v2 --output output/book_vi_v2.txt
```

Chỉ các mục glossary xuất hiện trong chunk mới được đưa vào prompt để giảm token.
Các dòng nguồn được gom thành segment khoảng 150-250 ký tự. Nếu thiếu, lặp hoặc đảo
ID, chương trình dịch lại các segment nhỏ bằng model nhanh trước khi dùng repair model.
Các số tuổi/thời gian rõ ràng cũng được đối chiếu trước khi lưu.

### Quick Translator reference (tùy chọn)

Pipeline có thể đọc trực tiếp `Names`, `Names2` và `VietPhrase` từ một thư mục
`QT2025` bên ngoài dự án. Chỉ những mục thực sự xuất hiện trong chunk mới được
đưa vào prompt dưới dạng tham khảo; Gemini vẫn tạo bản dịch cuối cùng và glossary
của truyện luôn có quyền ưu tiên cao hơn.

```env
QT_REFERENCE_DIR=C:\path\to\quick-translator-engine\QT2025
QT_REFERENCE_MAX_NAMES=20
QT_REFERENCE_MAX_TERMS=40
```

Không sao chép `QT2025` vào repository này. Khi `QT_REFERENCE_DIR` để trống,
pipeline hoạt động như trước. Thay đổi file dictionary sẽ làm checkpoint liên quan
hết hiệu lực để tránh tái sử dụng bản dịch với reference cũ.

Quy chuẩn văn phong Gemini nằm ở `data/translation_rules.txt`, được tự động chèn
vào mọi prompt dịch. Quy chuẩn hiện ưu tiên văn phong tiên hiệp Việt hóa tự nhiên,
xưng hô nhất quán, dễ đọc audio và bắt buộc `江凡/Giang Phàm → Phương Thần`.

Parser hiện hỗ trợ cấu trúc HTML công khai của 97du, Bqgns và Biquge321. Với Biquge321,
có thể truyền URL mục lục `/xiaoshuo/<book>/` hoặc URL của một chương
`/zhangjie/<book>/<chapter>.html`; crawler sẽ tự tìm mục lục, lấy nội dung trong `#txt`
và bỏ dòng quảng cáo/phân trang. Ví dụ để crawl từ chương 1799 đến chương hiện có cuối cùng:

```bat
python main.py crawl --url "https://www.biquge321.com/zhangjie/188928/265041198.html" --start 1799 --end 2066
```

Nếu site đổi selector hoặc nội dung được render bằng JavaScript, crawler sẽ dừng lưu
chương đó và báo lỗi; phiên bản này không tự thêm browser automation.

## Kiểm thử

```bat
python -m unittest discover -s tests -v
```

