Dán nguyên prompt dưới đây vào Codex:

```text
Bạn là Senior Node.js/TypeScript Engineer. Hãy xây dựng mới hoàn toàn một crawler truyện có cấu trúc production để tải các chương truyện công khai từ:

https://truyendich.live/

Không sử dụng lại mã nguồn hoặc thư mục cũ.

==================================================
1. CÔNG NGHỆ BẮT BUỘC
==================================================

Sử dụng:

- Node.js 22+
- TypeScript
- Playwright
- Cheerio
- Pino
- Zod
- SQLite
- Commander.js
- dotenv

Không sử dụng Python.

Playwright dùng để:

- Mở Chromium có giao diện.
- Cho người dùng tự xác minh CAPTCHA khi cần.
- Lưu cookie và phiên trình duyệt.
- Lấy HTML thực tế của trang.

Cheerio dùng để:

- Phân tích HTML.
- Lấy metadata truyện.
- Lấy danh sách chương.
- Làm sạch nội dung chương.

SQLite dùng để:

- Lưu trạng thái chương đã tải.
- Lưu URL chương.
- Lưu lỗi và checkpoint.
- Tiếp tục chính xác khi chương trình bị tắt.

==================================================
2. MỤC TIÊU
==================================================

Người dùng nhập URL truyện, ví dụ:

https://truyendich.live/doc-truyen/cuu-vuc-pham-tien

Chương trình phải:

1. Mở URL truyện bằng Chromium.
2. Cho người dùng tự xác minh CAPTCHA đầu tiên nếu xuất hiện.
3. Lưu phiên trình duyệt vào file.
4. Lấy thông tin truyện:
   - Tên truyện.
   - Tác giả nếu có.
   - Trạng thái.
   - Tổng số chương.
   - Ảnh bìa nếu có.
   - Danh sách URL chương.
5. Tải lần lượt từng chương.
6. Làm sạch nội dung.
7. Lưu từng chương thành file TXT UTF-8.
8. Ghi trạng thái vào SQLite.
9. Có khả năng chạy tiếp từ chương chưa hoàn thành.
10. Không tải lại chương đã tải thành công.

==================================================
3. QUY ĐỊNH VỀ CAPTCHA VÀ CHỐNG BOT
==================================================

Không được viết mã:

- Tự động giải CAPTCHA.
- Tự động click hoặc vượt CAPTCHA.
- Giả fingerprint trình duyệt.
- Sử dụng stealth plugin để che giấu automation.
- Xoay proxy.
- Tự động thay đổi IP.
- Điều khiển Cloudflare WARP hoặc ứng dụng 1.1.1.1.
- Né HTTP 403 hoặc 429.
- Tiếp tục gửi request sau khi website đã từ chối.

Người dùng có thể tự bật Cloudflare WARP trước khi chạy chương trình.

Chương trình không được:

- Kiểm soát WARP.
- Tắt bật WARP.
- Kiểm tra hoặc yêu cầu đổi IP.
- Dùng WARP để vượt giới hạn của website.

Quy trình CAPTCHA:

1. Mở Chromium ở chế độ headful.
2. Nếu phát hiện CAPTCHA hoặc trang xác minh:
   - In thông báo rõ ràng trên terminal.
   - Tạm dừng crawler.
   - Cho người dùng tự hoàn thành CAPTCHA trong trình duyệt.
3. Sau khi xác minh thành công:
   - Kiểm tra trang đã có nội dung truyện hợp lệ.
   - Lưu Playwright storage state.
4. Nếu CAPTCHA xuất hiện lại trong lúc tải chương:
   - Lưu checkpoint.
   - Tạm dừng.
   - Không tự động vượt qua.
   - Chờ người dùng xác minh thủ công hoặc thoát.

Lưu storage state tại:

data/browser-state.json

==================================================
4. GIỚI HẠN TỐC ĐỘ
==================================================

Thiết lập mặc định:

- Concurrency: 1.
- Chỉ mở một trang chương tại một thời điểm.
- Delay ngẫu nhiên: 5–9 giây giữa mỗi chương.
- Sau mỗi 50 chương: nghỉ ngẫu nhiên 180–300 giây.
- Timeout: 30 giây.
- Retry lỗi mạng thông thường: tối đa 2 lần.
- Backoff:
  - Lần 1: 15 giây.
  - Lần 2: 60 giây.

Không retry liên tục.

Không gửi nhiều request song song.

Không prefetch hàng trăm URL cùng lúc.

Không tải:

- Ảnh không cần thiết.
- Video.
- Font.
- CSS.
- Quảng cáo.
- Script theo dõi.

Có thể chặn các loại tài nguyên không cần thiết bằng Playwright routing, nhưng không được chặn tài nguyên khiến nội dung chương không tải được.

==================================================
5. XỬ LÝ KHI BỊ CHẶN
==================================================

Phải nhận diện:

- HTTP 401
- HTTP 403
- HTTP 429
- HTTP 503
- HTTP 520
- HTTP 521
- HTTP 522
- Redirect bất thường
- Trang HTML rỗng
- Trang challenge
- CAPTCHA
- Trang Access Denied

Các từ khóa nhận diện:

- captcha
- verify you are human
- checking your browser
- just a moment
- access denied
- forbidden
- too many requests
- cloudflare
- xác minh bạn là con người
- truy cập bị từ chối

Xử lý:

HTTP 429:
- Đọc Retry-After nếu có.
- Lưu trạng thái hiện tại.
- Dừng crawler.
- Không tự động đổi IP.
- Không tiếp tục gửi request.

HTTP 401 hoặc 403:
- Lưu checkpoint.
- Chụp screenshot.
- Lưu HTML debug.
- Dừng crawler.

HTTP 503, 520, 521, 522:
- Retry tối đa 2 lần.
- Nếu tiếp tục lỗi thì dừng.

CAPTCHA hoặc challenge:
- Dừng tiến trình tải chương.
- Hiển thị trình duyệt cho người dùng.
- Cho phép xác minh thủ công.
- Không tự động vượt CAPTCHA.

==================================================
6. PHÂN TÍCH CẤU TRÚC WEBSITE
==================================================

Trước khi viết selector chính thức:

1. Mở trang truyện thực tế.
2. Lưu HTML vào thư mục debug.
3. Phân tích DOM.
4. Xác định selector:
   - Tên truyện.
   - Tác giả.
   - Tổng chương.
   - Danh sách chương.
   - Link phân trang.
5. Mở ít nhất một trang chương.
6. Xác định selector:
   - Tiêu đề chương.
   - Nội dung chương.
   - Nút chương trước.
   - Nút chương sau.

Không được tự bịa selector.

Nếu selector không chắc chắn, xây dựng mảng selector dự phòng:

const selectors = {
  storyTitle: [
    "...",
    "...",
    "..."
  ],
  chapterTitle: [
    "...",
    "...",
    "..."
  ],
  chapterContent: [
    "...",
    "...",
    "..."
  ]
};

Mỗi selector phải được thử lần lượt.

Khi không tìm thấy selector:

- Không lưu file chương sai.
- Lưu HTML vào debug.
- Chụp screenshot.
- Ghi lỗi vào SQLite.
- Ghi lỗi vào log.

==================================================
7. KIỂM TRA NỘI DUNG CHƯƠNG
==================================================

Không được coi HTTP 200 là tải thành công ngay lập tức.

Một chương hợp lệ phải có:

- Tiêu đề chương.
- Nội dung chương.
- Nội dung văn bản dài tối thiểu 300 ký tự.
- Không chứa trang CAPTCHA.
- Không chứa Access Denied.
- Không phải trang chủ.
- Không phải trang danh sách truyện.
- Không phải nội dung lỗi.

Kiểm tra URL cuối cùng sau redirect.

Nếu URL cuối cùng không còn thuộc truyendich.live hoặc không đúng URL chương dự kiến thì phải dừng.

Làm sạch nội dung:

- Xóa script.
- Xóa style.
- Xóa quảng cáo.
- Xóa nút điều hướng.
- Xóa breadcrumb.
- Xóa nội dung trùng.
- Chuẩn hóa khoảng trắng.
- Chuẩn hóa xuống dòng.
- Giữ nguyên dấu tiếng Việt.
- Không tự ý sửa nội dung truyện.

==================================================
8. CẤU TRÚC DỰ ÁN
==================================================

Tạo cấu trúc:

truyendich-crawler/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── env.ts
│   │   ├── selectors.ts
│   │   └── constants.ts
│   ├── cli/
│   │   └── commands.ts
│   ├── browser/
│   │   ├── browser-manager.ts
│   │   ├── session-manager.ts
│   │   └── resource-blocker.ts
│   ├── crawler/
│   │   ├── story-crawler.ts
│   │   ├── chapter-crawler.ts
│   │   ├── chapter-queue.ts
│   │   └── rate-limiter.ts
│   ├── parsers/
│   │   ├── story-parser.ts
│   │   ├── chapter-parser.ts
│   │   └── content-cleaner.ts
│   ├── detectors/
│   │   ├── challenge-detector.ts
│   │   ├── response-detector.ts
│   │   └── content-validator.ts
│   ├── database/
│   │   ├── database.ts
│   │   ├── migrations.ts
│   │   └── repositories/
│   │       ├── story-repository.ts
│   │       ├── chapter-repository.ts
│   │       └── error-repository.ts
│   ├── storage/
│   │   ├── file-writer.ts
│   │   ├── filename.ts
│   │   └── debug-writer.ts
│   ├── logging/
│   │   └── logger.ts
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       ├── delay.ts
│       ├── retry.ts
│       ├── url.ts
│       └── text.ts
├── data/
│   ├── browser-state.json
│   └── crawler.sqlite
├── output/
├── debug/
├── screenshots/
└── logs/

==================================================
9. DATABASE SQLITE
==================================================

Tạo bảng stories:

- id
- url
- slug
- title
- author
- total_chapters
- created_at
- updated_at

Tạo bảng chapters:

- id
- story_id
- chapter_number
- title
- url
- status
- file_path
- content_length
- retry_count
- error_message
- created_at
- updated_at
- completed_at

Status gồm:

- pending
- processing
- completed
- failed
- blocked
- challenge

Tạo bảng crawler_runs:

- id
- story_id
- started_at
- stopped_at
- status
- last_completed_chapter
- stop_reason

Tạo bảng errors:

- id
- story_id
- chapter_id
- url
- error_type
- message
- html_path
- screenshot_path
- created_at

Phải có unique constraint cho URL chương để không lưu trùng.

==================================================
10. ĐỊNH DẠNG OUTPUT
==================================================

Cấu trúc:

output/
└── ten-truyen/
    ├── metadata.json
    ├── 000001_chuong-1.txt
    ├── 000002_chuong-2.txt
    └── 000003_chuong-3.txt

Tên file phải:

- Có số chương padding 6 chữ số.
- Không chứa ký tự cấm trên Windows.
- Không dài quá mức an toàn.
- Không bị trùng tên.

Nội dung file:

Tên truyện: ...
Tên chương: ...
Chương số: ...
Nguồn: ...
Thời gian tải: ...

========================================

NỘI DUNG

...

File phải dùng UTF-8.

Ghi file theo kiểu atomic:

1. Ghi vào file tạm.
2. Kiểm tra dữ liệu.
3. Đổi tên sang file chính thức.
4. Chỉ đánh dấu completed sau khi đổi tên thành công.

==================================================
11. CLI
==================================================

Hỗ trợ:

npm run dev -- crawl --url "URL_TRUYEN"

npm run dev -- crawl \
  --url "URL_TRUYEN" \
  --start 1 \
  --end 200

npm run dev -- resume

npm run dev -- inspect \
  --url "URL_TRUYEN"

npm run dev -- status

npm run dev -- retry-failed

Các tham số:

--url
--start
--end
--headful
--resume
--delay-min
--delay-max
--break-after
--break-min
--break-max

Mặc định:

- headful = true
- delay-min = 5
- delay-max = 9
- break-after = 50
- break-min = 180
- break-max = 300

Không cho phép concurrency lớn hơn 1.

Nếu người dùng truyền concurrency lớn hơn 1 thì báo lỗi cấu hình.

==================================================
12. CHẾ ĐỘ INSPECT
==================================================

Tạo lệnh inspect để hỗ trợ phân tích website:

npm run dev -- inspect --url "URL"

Chế độ này phải:

- Mở URL bằng Chromium.
- Chờ người dùng xác minh thủ công nếu cần.
- In:
  - HTTP status.
  - URL cuối cùng.
  - Tiêu đề trang.
  - Các thẻ heading.
  - Các selector tiềm năng.
- Lưu HTML.
- Chụp screenshot toàn trang.
- Không tải hàng loạt chương.

==================================================
13. LOGGING
==================================================

Dùng Pino.

Log ra console và file:

logs/crawler-YYYY-MM-DD.log

Mỗi chapter log:

- Thời gian.
- Số chương.
- URL.
- Trạng thái phản hồi.
- URL cuối cùng.
- Thời gian tải.
- Số ký tự.
- Trạng thái kết quả.
- Số lần retry.

Không ghi cookie hoặc dữ liệu phiên nhạy cảm vào log.

==================================================
14. SESSION VÀ BROWSER
==================================================

Lần chạy đầu:

- Luôn mở Chromium headful.
- Nạp browser-state.json nếu tồn tại.
- Nếu state hết hạn thì cho người dùng xác minh lại.
- Sau khi truy cập thành công thì lưu state mới.

Không sử dụng persistent profile hệ thống của Chrome cá nhân.

Tạo browser context riêng cho crawler.

Không đọc cookie từ Chrome cá nhân.

Không nhập cookie từ trình duyệt khác.

==================================================
15. XỬ LÝ TẮT CHƯƠNG TRÌNH
==================================================

Bắt các tín hiệu:

- SIGINT
- SIGTERM
- uncaughtException
- unhandledRejection

Khi dừng:

1. Dừng queue.
2. Không nhận chương mới.
3. Chờ tác vụ hiện tại kết thúc trong thời gian giới hạn.
4. Lưu trạng thái database.
5. Đóng page.
6. Đóng context.
7. Đóng browser.
8. Đóng database.
9. Ghi lý do dừng vào crawler_runs.

==================================================
16. README
==================================================

README phải hướng dẫn đầy đủ trên Windows:

Cài Node.js 22+.

Chạy:

npm install
npx playwright install chromium
copy .env.example .env
npm run dev -- inspect --url "URL_TRUYEN"
npm run dev -- crawl --url "URL_TRUYEN"

Hướng dẫn:

- Cách tự xác minh CAPTCHA.
- Cách tiếp tục sau khi tắt.
- Cách xem chương lỗi.
- Cách chạy lại chapter failed.
- Cách thay đổi delay.
- Ý nghĩa các trạng thái SQLite.
- Cách xóa phiên trình duyệt khi phiên bị lỗi.

Nêu rõ:

- Không sử dụng crawler để vượt kiểm soát truy cập.
- Không tự động giải CAPTCHA.
- Không dùng proxy rotation.
- Không dùng WARP để né giới hạn.
- Khi nhận 403 hoặc 429 phải dừng.

==================================================
17. YÊU CẦU CHẤT LƯỢNG
==================================================

- TypeScript strict mode.
- Không sử dụng any nếu không thật sự cần.
- Dùng interface hoặc type rõ ràng.
- Dùng Zod để validate config và dữ liệu parser.
- Mỗi module có trách nhiệm riêng.
- Không đặt toàn bộ logic trong một file.
- Không hard-code đường dẫn.
- Hỗ trợ Windows.
- Xử lý lỗi filesystem.
- Xử lý lỗi SQLite.
- Xử lý lỗi trình duyệt bị đóng.
- Không để promise không được await.
- Có comment cho các đoạn quan trọng.
- Có unit test cho:
  - Chuẩn hóa tên file.
  - Làm sạch nội dung.
  - Phát hiện challenge.
  - Validate chapter.
  - Parse số chương từ URL.

==================================================
18. TRÌNH TỰ THỰC HIỆN
==================================================

Thực hiện theo thứ tự:

Bước 1:
- Khởi tạo project.
- Tạo package.json và tsconfig.json.

Bước 2:
- Viết lệnh inspect.
- Phân tích HTML thực tế của trang truyện và trang chương.

Bước 3:
- Báo cáo selector đã xác định.
- Nêu rõ selector nào chắc chắn và selector nào dự phòng.

Bước 4:
- Xây dựng database và migration.

Bước 5:
- Xây dựng crawler danh sách chương.

Bước 6:
- Xây dựng crawler nội dung chương.

Bước 7:
- Thêm validation, challenge detection và rate limiting.

Bước 8:
- Thêm resume và checkpoint.

Bước 9:
- Thêm CLI, logging, debug HTML và screenshot.

Bước 10:
- Viết test và README.

Không được tuyên bố hoàn thành khi chưa:

- Chạy được TypeScript build.
- Chạy được inspect.
- Tạo được database.
- Lưu được ít nhất một chương thử nghiệm hợp lệ.
- Resume không tải lại chương đã hoàn thành.

Sau mỗi bước, hãy ghi rõ:

- File nào đã tạo.
- File nào đã sửa.
- Lệnh cần chạy.
- Kết quả kiểm thử.
- Lỗi còn tồn tại.
```
