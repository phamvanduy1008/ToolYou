Hãy xây dựng một tool Python để tải hàng loạt EPUB từ website:

https://dtv-ebook.com.vn/

MỤC TIÊU
========

Tôi chỉ muốn thu thập truyện thuộc 2 thể loại:

1. Tiên hiệp
   https://dtv-ebook.com.vn/tien-hiep-488.html

2. Huyền ảo
   https://dtv-ebook.com.vn/huyen-ao-497.html

Chỉ tải các truyện:

- Có tình trạng "Hoàn Thành" / "Hoàn thành".
- Có định dạng EPUB.
- Link EPUB được cung cấp công khai trên trang chi tiết.
- Không crawl nội dung từng chương.
- Không tải PDF/MOBI/AZW3.
- Không vượt qua đăng nhập, captcha, paywall hoặc cơ chế hạn chế truy cập.


Mặc định KHÔNG coi:
- "Chương xxx"
- "Dịch xxx"
- "CV xxx"
- "CV FULL"

là "Hoàn Thành".

Tuy nhiên tạo config:

ALLOW_CV_FULL = false

để sau này có thể bật nếu muốn.

==================================================
1. CẤU TRÚC WEBSITE
==================================================

Trang category có dạng:

Tiên hiệp:

https://dtv-ebook.com.vn/tien-hiep-488.html
https://dtv-ebook.com.vn/tien-hiep-488/2.html
https://dtv-ebook.com.vn/tien-hiep-488/3.html
...

Huyền ảo:

https://dtv-ebook.com.vn/huyen-ao-497.html
https://dtv-ebook.com.vn/huyen-ao-497/2.html
https://dtv-ebook.com.vn/huyen-ao-497/3.html
...

KHÔNG hard-code số trang.

Hãy đọc pagination của trang để tự phát hiện các page.

Nếu không xác định được max page thì:

- crawl page 1
- page 2
- page 3...
- dừng khi:
    + trang trả 404
    + hoặc không còn item truyện
    + hoặc trang có text "Chưa có dữ liệu"
    + hoặc không tìm được truyện mới

Phải chống vòng lặp pagination.

==================================================
2. PHÂN BIỆT TRANG TRUYỆN
==================================================

Trang chi tiết truyện thường có URL dạng:

https://dtv-ebook.com.vn/slug-ten-truyen_26722.html

Ví dụ:

https://dtv-ebook.com.vn/qua-mang_26722.html

Có thể dùng pattern:

_[0-9]+\.html$

để nhận diện URL detail.

Không lấy các link sidebar như:

- Xem nhiều nhất
- Bài viết mới
- Cập nhật mới nhất
- footer
- menu
- quảng cáo

Ưu tiên tìm container chính của danh sách category.

Nếu selector CSS thay đổi thì fallback bằng:

- URL pattern detail
- title của item
- status nằm trong cùng card/item

Sau đó vẫn phải vào detail page để xác nhận metadata lần cuối.

==================================================
3. KIỂM TRA TRANG DETAIL
==================================================

Khi vào trang detail, lấy:

title
author
category
status
formats
translator/editor nếu có
source nếu có
detail_url

Ví dụ metadata hiện tại có dạng:

Tác giả | ...
Thể loại | Huyền ảo
Tình trạng | Hoàn Thành
Định dạng | eBook mobi pdf epub azw3

Không được chỉ search chữ "Hoàn Thành" trên toàn HTML vì sidebar cũng có
nhiều truyện khác ghi Hoàn Thành.

Phải lấy status từ block metadata của chính truyện.

Normalize status:

strip()
lower()
unicode normalize

Các giá trị chấp nhận:

"hoàn thành"
"hoàn thanh"

Nếu ALLOW_CV_FULL=true thì thêm:

"cv full"

==================================================
4. TÌM LINK EPUB
==================================================

Trên detail page có section kiểu:

"Tải ebook [Tên truyện]"

và các nút:

⬇ Tải AZW3
⬇ Tải EPUB
⬇ Tải MOBI
⬇ Tải PDF

Chỉ lấy anchor EPUB.

Có thể tìm:

a[href]

với text sau normalize chứa:

"tải epub"

Nếu không tìm được thì fallback:

- text == EPUB
- href chứa docs.google.com
- anchor nằm trong khu vực download
- không lấy các link tag/search có chữ epub ở phần metadata

Ví dụ link tải hiện tại có dạng:

https://docs.google.com/uc?export=download&id=FILE_ID

Khi request URL này Google có thể redirect thành:

https://drive.usercontent.google.com/download?id=FILE_ID&export=download

Dùng:

requests.Session()
allow_redirects=True
stream=True

để tải.

KHÔNG hard-code domain cuối vì Google có thể thay đổi redirect.

==================================================
5. VALIDATE FILE
==================================================

Không được cứ HTTP 200 là coi tải thành công.

Sau khi download:

1. Kiểm tra Content-Type.

2. Nếu Content-Type là:
   text/html
   thì coi là lỗi hoặc trang trung gian.

3. File EPUB về bản chất là ZIP.

Kiểm tra:

- file bắt đầu hợp lệ như ZIP
- zipfile.is_zipfile(file) == True

Sau đó mở ZIP và kiểm tra có file:

mimetype

và nội dung:

application/epub+zip

Nếu đúng mới đánh dấu SUCCESS.

Nếu HTML / lỗi Google Drive:
- không bypass captcha/access restriction
- ghi FAILED vào log
- tiếp tục truyện tiếp theo

==================================================
6. TÊN FILE
==================================================

Tên file:

[Tên truyện] - [Tác giả].epub

Ví dụ:

Qua Mang - Quan Quan Cong Tu.epub

hoặc giữ Unicode:

Quá Mãng - Quan Quan Công Tử.epub

Tạo function sanitize_filename().

Loại bỏ ký tự Windows không hỗ trợ:

< > : " / \ | ? *

Không để filename quá dài.

==================================================
7. THƯ MỤC
==================================================

Tạo:

downloads/
    Tien Hiep/
    Huyen Ao/

Ví dụ:

downloads/
    Tien Hiep/
        Nhat Niem Vinh Hang - Nhi Can.epub

    Huyen Ao/
        Qua Mang - Quan Quan Cong Tu.epub

Nếu một truyện xuất hiện ở cả hai category:
chỉ tải một lần.

Dùng detail URL hoặc Google Drive file ID làm unique key.

==================================================
8. KHÔNG TẢI LẠI
==================================================

Tạo file:

data/downloaded.json

Ví dụ:

{
  "26722": {
      "title": "Quá Mãng",
      "author": "Quan Quan Công Tử",
      "category": "Huyền ảo",
      "detail_url": "...",
      "epub_url": "...",
      "file": "...",
      "status": "success"
  }
}

Trước khi tải:

- kiểm tra ID đã SUCCESS chưa
- kiểm tra file tồn tại chưa

Nếu rồi thì:

SKIP

Tool phải hỗ trợ resume nếu đang chạy bị tắt.

==================================================
9. CSV DATABASE
==================================================

Ngoài JSON tạo:

data/books.csv

columns:

id
title
author
category
status
translation_type
source
detail_url
epub_url
download_status
file_path
file_size
error

Ví dụ status:

SUCCESS
SKIPPED
NO_EPUB
NOT_COMPLETED
FAILED

==================================================
10. CHẤT LƯỢNG BẢN DỊCH
==================================================

Trang DTV có thể có:

Dịch giả: ...
Editor: ...
AI dịch
CV FULL
Convert

Hãy lấy thông tin này nếu có.

Thêm field:

translation_type

Giá trị cố gắng phân loại:

HUMAN
AI
CONVERT
UNKNOWN

Quy tắc gợi ý:

nếu text chứa:
"AI dịch"
=> AI

nếu chứa:
"CV FULL"
"Convert"
=> CONVERT

nếu có "Dịch giả:" hoặc "Editor:"
nhưng không phải AI
=> HUMAN

Không dùng field này để bỏ truyện.
Chỉ lưu metadata để sau này tôi lọc.

==================================================
11. RATE LIMIT
==================================================

Không spam server.

Mỗi request DTV delay ngẫu nhiên khoảng:

1.5 - 3 giây

Google Drive download không chạy quá 1-2 file đồng thời.

Retry:

429
500
502
503
504

theo exponential backoff:

2s
4s
8s
16s

Tối đa 4 lần.

User-Agent rõ ràng.

Respect robots.txt / điều khoản website nếu có.

Không bypass Cloudflare/captcha/login.

==================================================
12. CLI
==================================================

Tool chạy như:

python main.py

Có option:

python main.py --category tien-hiep

python main.py --category huyen-ao

python main.py --category all

python main.py --scan-only

python main.py --download

python main.py --resume

Ví dụ:

python main.py --category all --download

SCAN ONLY:

chỉ crawl danh sách và tạo books.csv,
không tải ebook.

DOWNLOAD:

tải các EPUB đủ điều kiện.

==================================================
13. HIỂN THỊ TERMINAL
==================================================

Dùng rich hoặc tqdm.

Ví dụ:

[SCAN] Tiên hiệp page 1
[SCAN] Found 45 books

[CHECK] Nhất Niệm Vĩnh Hằng
        Status: Hoàn Thành
        EPUB: YES

[DOWNLOAD 12/180]
Nhất Niệm Vĩnh Hằng
6.8 MB
████████████████ 100%

[SUCCESS]

[SKIP]
Đế Bá
Reason: already downloaded

[SKIP]
Tiên Công Khai Vật
Reason: not completed

==================================================
14. KIẾN TRÚC CODE
==================================================

Tách thành:

main.py

src/
    crawler.py
    parser.py
    downloader.py
    storage.py
    models.py
    utils.py

data/
    books.csv
    downloaded.json

downloads/
    Tien Hiep/
    Huyen Ao/

requirements.txt
README.md

==================================================
15. CRAWLER FLOW
==================================================

Luồng chính:

CATEGORY
   ↓
detect pagination
   ↓
category page
   ↓
extract detail URLs
   ↓
dedupe
   ↓
DETAIL PAGE
   ↓
parse metadata
   ↓
status == Hoàn Thành?
   ├── NO → skip
   ↓ YES
contains EPUB?
   ├── NO → NO_EPUB
   ↓ YES
find EPUB download URL
   ↓
save metadata
   ↓
download
   ↓
follow Google redirect
   ↓
validate EPUB
   ↓
save file
   ↓
record SUCCESS

==================================================
16. QUAN TRỌNG
==================================================

Website có nhiều block sidebar chứa truyện và chữ "Hoàn Thành".

Vì vậy tuyệt đối không dùng:

if "Hoàn Thành" in page.text

để xác định trạng thái.

Phải parse metadata của truyện.

Tương tự, không lấy anchor chỉ vì text chứa "epub",
vì trang có tag "epub".

Phải ưu tiên anchor:

"⬇ Tải EPUB"

trong phần Download.

==================================================
17. BƯỚC DEBUG ĐẦU TIÊN
==================================================

Trước khi viết toàn bộ downloader:

1. Request:
   https://dtv-ebook.com.vn/huyen-ao-497.html

2. Print 5 truyện đầu tiên:
   title
   detail_url
   status shown in card

3. Request một detail page.

4. Print:
   title
   author
   status
   epub_url

5. Test download DUY NHẤT 1 EPUB.

6. Validate file EPUB.

Chỉ khi test 1 file thành công mới triển khai bulk crawler.

Nếu HTML thực tế khác selector dự kiến:
hãy inspect DOM và điều chỉnh selector,
không dùng Selenium ngay.

Chỉ dùng Playwright/Selenium nếu nội dung bắt buộc render JavaScript.
Trang hiện tại ưu tiên requests + BeautifulSoup.

==================================================
18. KẾT QUẢ TÔI MUỐN
==================================================

Sau khi hoàn thành tôi chỉ cần chạy:

python main.py --category all --download

Tool sẽ:

- quét toàn bộ Tiên hiệp
- quét toàn bộ Huyền ảo
- chỉ chọn Hoàn Thành
- tìm EPUB
- tải về
- không tải trùng
- có thể resume
- lưu metadata CSV/JSON
- bỏ qua lỗi và tiếp tục
- cuối cùng in thống kê:

Total scanned:
Completed:
EPUB available:
Downloaded:
Skipped:
Failed:
Human translated:
AI translated:
Convert:

==================================================
19. QUY TẮC LƯU THƯ MỤC TRUYỆN
==================================================

Tôi muốn file EPUB được lưu theo:

Thể loại
    ↓
Loại bản dịch
    ↓
File truyện

Ví dụ:

downloads/
│
├── Tien Hiep/
│   ├── Dich/
│   │   ├── Nhat Niem Vinh Hang - Nhi Can.epub
│   │   ├── Tien Nghich - Nhi Can.epub
│   │   └── Nga Duc Phong Thien - Nhi Can.epub
│   │
│   ├── AI/
│   │   └── Ten Truyen - Tac Gia.epub
│   │
│   ├── CV/
│   │   ├── Ten Truyen A.epub
│   │   └── Ten Truyen B.epub
│   │
│   └── Unknown/
│
└── Huyen Ao/
    ├── Dich/
    ├── AI/
    ├── CV/
    └── Unknown/

Tên thư mục có thể sử dụng Unicode:

downloads/
├── Tiên Hiệp/
│   ├── Dịch/
│   ├── AI/
│   ├── CV/
│   └── Chưa xác định/
│
└── Huyền Ảo/
    ├── Dịch/
    ├── AI/
    ├── CV/
    └── Chưa xác định/

Ưu tiên sử dụng tên tiếng Việt Unicode nếu hệ điều hành hỗ trợ.

==================================================
20. PHÂN LOẠI DỊCH / AI / CV
==================================================

Trước khi quyết định thư mục lưu file,
hãy phân tích metadata của trang truyện.

Tạo field:

translation_type

Có 4 giá trị:

HUMAN
AI
CONVERT
UNKNOWN

Mapping folder:

HUMAN
=> Dịch/

AI
=> AI/

CONVERT
=> CV/

UNKNOWN
=> Chưa xác định/

--------------------------------------------------
HUMAN / Dịch
--------------------------------------------------

Nếu trang có các thông tin kiểu:

"Dịch giả:"
"Người dịch:"
"Editor:"
"Biên tập:"
"Nhóm dịch:"

và KHÔNG có các từ chỉ AI / Convert

thì:

translation_type = HUMAN

Ví dụ:

Tiên Hiệp/
    Dịch/
        Nhất Niệm Vĩnh Hằng - Nhĩ Căn.epub

--------------------------------------------------
AI
--------------------------------------------------

Nếu metadata / mô tả chứa:

"AI dịch"
"Dịch AI"
"AI Translate"
"AI đã edit"
"AI dịch đã edit"

thì:

translation_type = AI

Ví dụ:

Huyền Ảo/
    AI/
        Ten Truyen - Tac Gia.epub

--------------------------------------------------
CV / Convert
--------------------------------------------------

Nếu metadata / mô tả chứa:

"CV FULL"
"CV"
"Convert"
"Converted"
"Bản convert"
"Convert full"

thì:

translation_type = CONVERT

Ví dụ:

Tiên Hiệp/
    CV/
        Ten Truyen - Tac Gia.epub

--------------------------------------------------
UNKNOWN
--------------------------------------------------

Nếu không đủ dữ liệu để xác định:

translation_type = UNKNOWN

Không được tự đoán rằng truyện là bản Dịch.

Lưu vào:

Thể loại/
    Chưa xác định/

để tôi kiểm tra thủ công sau.

==================================================
21. THỨ TỰ ƯU TIÊN PHÂN LOẠI
==================================================

Một trang có thể xuất hiện nhiều từ khóa.

Hãy áp dụng ưu tiên:

1. AI
2. CV / Convert
3. Human / Dịch
4. Unknown

Ví dụ:

"Dịch giả: ABC - AI dịch đã edit"

KHÔNG được phân loại HUMAN.

Phải là:

AI

Ví dụ:

"Editor ABC - bản Convert"

Phải là:

CONVERT

==================================================
22. TRUYỆN CÓ NHIỀU GIAI ĐOẠN DỊCH
==================================================

Có trường hợp:

Chương 1 - 1000: người dịch
Chương 1001 - 1500: AI

hoặc:

Dịch đến chương 900
CV đến chương 1600

Khi gặp trường hợp này:

translation_type = MIXED

và lưu vào:

Thể loại/
    Hỗn hợp/

Ví dụ:

Tiên Hiệp/
    Hỗn hợp/
        Ten Truyen - Tac Gia.epub

Thêm MIXED vào CSV.

translation_type values cuối cùng:

HUMAN
AI
CONVERT
MIXED
UNKNOWN

==================================================
23. FILE METADATA BÊN CẠNH EPUB
==================================================

Ngoài EPUB, có option:

SAVE_METADATA = true

Nếu bật,
mỗi EPUB có thêm file JSON cùng tên.

Ví dụ:

Tiên Hiệp/
    Dịch/
        Nhất Niệm Vĩnh Hằng - Nhĩ Căn.epub
        Nhất Niệm Vĩnh Hằng - Nhĩ Căn.json

JSON:

{
    "title": "Nhất Niệm Vĩnh Hằng",
    "author": "Nhĩ Căn",
    "category": "Tiên Hiệp",
    "status": "Hoàn Thành",
    "translation_type": "HUMAN",
    "translator": "...",
    "editor": "...",
    "source": "...",
    "detail_url": "...",
    "epub_url": "...",
    "file_size": 12345678
}

Mục đích:

- sau này dễ tìm truyện
- dễ lọc theo Dịch / AI / CV
- không cần crawl web lại
- có thể viết tool quản lý thư viện sau này

==================================================
24. NẾU TRUYỆN THUỘC NHIỀU THỂ LOẠI
==================================================

Một truyện có thể được DTV gắn cả:

Tiên Hiệp
Huyền Ảo

Không tải EPUB 2 lần.

Chỉ tải file một lần.

Ưu tiên category theo nơi phát hiện đầu tiên.

Nhưng trong metadata lưu:

categories = [
    "Tiên Hiệp",
    "Huyền Ảo"
]

Có thể quy định ưu tiên:

Tiên Hiệp > Huyền Ảo

Nếu truyện đã tồn tại:

downloads/
    Tiên Hiệp/
        Dịch/
            ABC.epub

thì khi crawler gặp lại nó ở Huyền Ảo:

SKIP DUPLICATE

không tạo:

Huyền Ảo/
    Dịch/
        ABC.epub

==================================================
25. TÊN FILE
==================================================

Format:

Tên truyện - Tác giả.epub

Ví dụ:

Nhất Niệm Vĩnh Hằng - Nhĩ Căn.epub
Tiên Nghịch - Nhĩ Căn.epub
Già Thiên - Thần Đông.epub

Nếu không xác định được tác giả:

Tên truyện.epub

sanitize filename để chạy tốt trên Windows.

Không sử dụng các ký tự:

< > : " / \ | ? *

Không đặt dấu chấm hoặc khoảng trắng ở cuối filename.

==================================================
26. KẾT QUẢ THƯ MỤC MONG MUỐN
==================================================

Sau khi tải xong, tôi muốn thư viện giống:

downloads/
│
├── Tiên Hiệp/
│   │
│   ├── Dịch/
│   │   ├── Cầu Ma - Nhĩ Căn.epub
│   │   ├── Nhất Niệm Vĩnh Hằng - Nhĩ Căn.epub
│   │   └── Tiên Nghịch - Nhĩ Căn.epub
│   │
│   ├── AI/
│   │   ├── Truyen A.epub
│   │   └── Truyen B.epub
│   │
│   ├── CV/
│   │   ├── Truyen C.epub
│   │   └── Truyen D.epub
│   │
│   ├── Hỗn hợp/
│   │   └── Truyen E.epub
│   │
│   └── Chưa xác định/
│       └── Truyen F.epub
│
└── Huyền Ảo/
    │
    ├── Dịch/
    ├── AI/
    ├── CV/
    ├── Hỗn hợp/
    └── Chưa xác định/

==================================================
27. THỐNG KÊ SAU KHI CHẠY
==================================================

Cuối chương trình in:

============= SUMMARY =============

Total scanned:          1240
Completed:               613
EPUB available:          580

Downloaded:              421
Already downloaded:      139
Failed:                   20

--------- Translation ---------

Dịch người:              245
AI:                       74
CV / Convert:             61
Hỗn hợp:                  24
Chưa xác định:            17

--------- Category ------------

Tiên Hiệp:               260
Huyền Ảo:                161

================================