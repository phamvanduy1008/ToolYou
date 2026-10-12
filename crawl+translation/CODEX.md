# CODEX.md — Novel Crawler + Gemini Translator

## 1. Mục tiêu

Xây dựng một tool Python chạy local để:

1. Crawl truyện từ một website nguồn mà người dùng có quyền truy cập.
2. Lấy danh sách chương, tiêu đề chương và nội dung chương.
3. Lưu bản gốc tiếng Trung xuống local để không phải crawl lại.
4. Dùng Gemini API dịch từng chương sang tiếng Việt.
5. Có cơ chế resume khi crawl/dịch bị lỗi giữa chừng.
6. Giữ tên riêng, cảnh giới, công pháp, địa danh nhất quán bằng glossary.
7. Có thể export toàn bộ truyện đã dịch sang TXT.
8. Thiết kế module rõ ràng để sau này có thể đổi website nguồn hoặc đổi model AI.

Tool phải ưu tiên độ ổn định, dễ debug, dễ tiếp tục sau lỗi hơn là tốc độ.

---

## 2. Nguyên tắc bắt buộc

- Không bypass CAPTCHA.
- Không bypass paywall/VIP/login.
- Không tìm cách vượt anti-bot hoặc cơ chế kiểm soát truy cập.
- Nếu server trả 401/403/429 liên tục thì dừng hoặc backoff, không tìm cách né chặn.
- Crawl có delay giữa các request.
- Tôn trọng robots.txt và điều khoản sử dụng của website khi áp dụng.
- Chỉ crawl nội dung người dùng có quyền truy cập.
- Không hardcode Gemini API key.
- Không commit `.env`.
- Không crawl lại chương đã tải thành công.
- Không dịch lại chương đã dịch thành công trừ khi người dùng yêu cầu `--force`.
- Raw data và translated data phải tách riêng.
- Không nối crawl và translate thành một tiến trình duy nhất.

---

## 3. Công nghệ

Python 3.11+.

Dependencies chính:

```txt
requests
beautifulsoup4
lxml
python-dotenv
google-genai
tenacity
```

Có thể thêm:

```txt
rich
typer
```

nếu muốn CLI đẹp hơn.

Không dùng Selenium/Playwright ở phiên bản đầu tiên nếu website trả HTML đầy đủ bằng HTTP thông thường.

---

## 4. Cấu trúc project

Tạo cấu trúc:

```text
novel-translator/
├── CODEX.md
├── README.md
├── requirements.txt
├── .env.example
├── .gitignore
├── main.py
│
├── app/
│   ├── __init__.py
│   ├── config.py
│   │
│   ├── crawler/
│   │   ├── __init__.py
│   │   ├── client.py
│   │   ├── parser.py
│   │   └── crawler.py
│   │
│   ├── translator/
│   │   ├── __init__.py
│   │   ├── gemini_client.py
│   │   ├── splitter.py
│   │   ├── glossary.py
│   │   └── translator.py
│   │
│   ├── storage/
│   │   ├── __init__.py
│   │   ├── json_store.py
│   │   └── exporter.py
│   │
│   └── models/
│       ├── __init__.py
│       └── chapter.py
│
├── data/
│   ├── raw/
│   ├── translated/
│   ├── glossary.json
│   └── book.json
│
└── logs/
```

---

## 5. Biến môi trường

Tạo `.env.example`:

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
REQUEST_DELAY_MIN=1.5
REQUEST_DELAY_MAX=3.0
REQUEST_TIMEOUT=20
MAX_TRANSLATE_CHARS=6000
```

Model Gemini phải lấy từ biến môi trường, không hardcode model trong nhiều file.

Nếu model trong `.env` không tồn tại hoặc API trả lỗi model, log rõ lỗi để người dùng đổi model.

---

## 6. .gitignore

```gitignore
.env
__pycache__/
*.pyc
.venv/
venv/
logs/
data/raw/
data/translated/
```

Không ignore:

```text
data/glossary.json
data/book.json
```

vì đây là cấu hình dự án.

---

## 7. Data model

Tạo dataclass hoặc Pydantic-like plain dataclass cho Chapter.

Ví dụ:

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class Chapter:
    index: int
    title: str
    url: str
    content: Optional[str] = None
```

Raw JSON:

```json
{
  "index": 1,
  "title": "第一章 示例",
  "url": "https://example.com/chapter/1.html",
  "content": "原文内容...",
  "status": "crawled"
}
```

Translated JSON:

```json
{
  "index": 1,
  "url": "https://example.com/chapter/1.html",
  "title_cn": "第一章 示例",
  "title_vi": "Chương 1: Ví dụ",
  "content_cn": "原文内容...",
  "content_vi": "Nội dung tiếng Việt...",
  "status": "translated",
  "model": "gemini-2.5-flash"
}
```

File naming:

```text
data/raw/000001.json
data/raw/000002.json

data/translated/000001.json
data/translated/000002.json
```

Dùng 6 chữ số để sort ổn định.

---

## 8. book.json

`data/book.json` lưu metadata:

```json
{
  "title_cn": "",
  "title_vi": "",
  "author": "",
  "source_url": "",
  "source_domain": "",
  "last_crawled_at": null
}
```

Không hardcode URL truyện trong code.

CLI phải nhận URL từ argument hoặc đọc từ `book.json`.

---

## 9. HTTP Client

Tạo `app/crawler/client.py`.

Yêu cầu:

- Dùng `requests.Session()`.
- Có User-Agent thông thường.
- Timeout configurable.
- Retry chỉ với lỗi mạng tạm thời.
- Không retry vô hạn.
- Với 429: exponential backoff.
- Với 401/403: log và dừng request hiện tại.
- Không đổi proxy/user-agent liên tục để né chặn.
- Có delay ngẫu nhiên giữa request dựa trên `REQUEST_DELAY_MIN/MAX`.

Ví dụ headers:

```python
{
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/154.0.0.0 Safari/537.36"
    )
}
```

Encoding:

- Ưu tiên encoding server trả về nếu hợp lệ.
- Nếu text Trung bị lỗi encoding thì fallback `response.apparent_encoding`.

---

## 10. Parser architecture

Không viết selector trực tiếp trong `main.py`.

Tạo `app/crawler/parser.py`.

Parser phải có ít nhất:

```python
def parse_book_page(html: str, base_url: str) -> list[Chapter]:
    ...
```

và:

```python
def parse_chapter_page(html: str, url: str) -> tuple[str, str]:
    ...
```

Mục tiêu:

- `parse_book_page`: lấy danh sách chapter URLs.
- `parse_chapter_page`: lấy title + content.

Mọi selector đặc thù website phải nằm trong parser.

---

## 11. Website source

Nguồn đang được người dùng nghiên cứu là:

```text
https://www.97du.cc
```

Nhưng tuyệt đối không đoán selector nếu chưa kiểm tra HTML thật.

Trước khi implement parser đầy đủ:

1. Tải 1 trang book index.
2. Lưu HTML sample trong quá trình dev nếu cần.
3. Xác định selector thật của:
   - danh sách chương
   - link chương
   - title chương
   - content chương
4. Test với ít nhất 3 chương:
   - chương đầu
   - chương giữa
   - chương gần cuối

Nếu HTML không chứa nội dung thật mà cần JS, không tự động thêm browser automation. Hãy báo rõ trong README/TODO.

---

## 12. Chuẩn hóa danh sách chương

Khi lấy chapter links:

- Dùng `urljoin`.
- Loại duplicate URL.
- Giữ đúng thứ tự hiển thị.
- Không dựa duy nhất vào chữ `"章"` để xác định chapter nếu selector tốt hơn đã có.
- Nếu website chia pagination, parser/crawler phải hỗ trợ đọc đủ pagination theo cấu trúc công khai của site.
- Không brute-force đoán URL chương.

Ví dụ output:

```python
[
    Chapter(index=1, title="第一章 ...", url="..."),
    Chapter(index=2, title="第二章 ...", url="..."),
]
```

---

## 13. Làm sạch nội dung

Khi parse content:

Loại bỏ nếu nằm bên trong content container:

```text
script
style
noscript
iframe
```

Loại các đoạn quảng cáo/navigation rõ ràng nếu selector xác định chắc chắn.

Không dùng regex quá rộng có thể xóa nhầm nội dung truyện.

Chuẩn hóa:

- `\r\n` -> `\n`
- tối đa 2 newline liên tiếp
- trim whitespace đầu/cuối
- giữ paragraph boundaries

Không tự ý sửa nội dung tiếng Trung.

---

## 14. Crawler

Tạo `app/crawler/crawler.py`.

API mong muốn:

```python
def crawl_book(
    book_url: str,
    start: int | None = None,
    end: int | None = None,
    force: bool = False,
) -> None:
    ...
```

Logic:

1. Fetch book page.
2. Parse chapter list.
3. Filter `start/end`.
4. Với từng chapter:
   - nếu raw file tồn tại và hợp lệ -> SKIP
   - nếu `--force` -> crawl lại
   - request chapter
   - parse title/content
   - validate content không rỗng
   - save JSON atomic
   - sleep
5. Nếu lỗi:
   - log chapter index/url/error
   - không làm mất các chương đã thành công
   - tiếp tục chương tiếp theo với lỗi parser/network bình thường
   - nếu gặp dấu hiệu bị chặn hàng loạt -> dừng toàn job

---

## 15. Atomic save

Không ghi trực tiếp file cuối nếu quá trình có thể bị crash.

Dùng pattern:

```text
000001.json.tmp
↓
write hoàn tất
↓
rename thành
000001.json
```

Nhờ đó resume không nhầm file lỗi là file hoàn chỉnh.

---

## 16. Validate raw chapter

Một raw chapter được xem là hợp lệ khi:

- JSON parse được.
- `index` là integer > 0.
- `url` không rỗng.
- `title` không rỗng.
- `content` có độ dài hợp lý, ví dụ > 100 ký tự.

Nếu file tồn tại nhưng invalid thì crawl lại.

---

## 17. Gemini Client

Dùng official SDK:

```python
from google import genai
```

Tạo:

```text
app/translator/gemini_client.py
```

Client đọc:

```text
GEMINI_API_KEY
GEMINI_MODEL
```

từ env.

Không log API key.

---

## 18. Translation prompt

Prompt mặc định:

```text
Bạn là biên dịch viên tiểu thuyết huyền huyễn/tiên hiệp Trung-Việt.

Hãy dịch nguyên văn đoạn tiếng Trung bên dưới sang tiếng Việt.

Yêu cầu bắt buộc:
- Không tóm tắt.
- Không bỏ câu.
- Không thêm tình tiết.
- Không giải thích ngoài bản dịch.
- Giữ nguyên ý nghĩa.
- Văn phong tự nhiên, dễ nghe khi đọc audio.
- Danh xưng và cách xưng hô phải phù hợp ngữ cảnh.
- Tên riêng, địa danh, tông môn, công pháp, cảnh giới và pháp bảo phải tuân thủ glossary.
- Không thêm markdown.
- Chỉ trả về bản dịch tiếng Việt.

Glossary:
{glossary}

Nội dung:
{text}
```

Prompt phải được đặt trong một function riêng để dễ chỉnh.

---

## 19. Glossary

`data/glossary.json` ví dụ:

```json
{
  "江凡": "Giang Phàm",
  "许怡宁": "Hứa Di Ninh",
  "许悠然": "Hứa Du Nhiên",
  "太虚": "Thái Hư"
}
```

Tạo `app/translator/glossary.py`:

```python
def load_glossary(path: str) -> dict[str, str]:
    ...
```

và:

```python
def format_glossary_for_prompt(glossary: dict[str, str]) -> str:
    ...
```

Output prompt:

```text
江凡 = Giang Phàm
许怡宁 = Hứa Di Ninh
...
```

Nếu glossary rỗng vẫn phải dịch được.

---

## 20. Text splitter

Tạo `app/translator/splitter.py`.

Không cắt cứng theo character nếu có thể tránh.

Ưu tiên split theo paragraph:

```python
def split_text(text: str, max_chars: int) -> list[str]:
    ...
```

Algorithm:

1. Split theo newline/paragraph.
2. Ghép paragraph cho tới gần `MAX_TRANSLATE_CHARS`.
3. Nếu một paragraph đơn lẻ quá dài:
   - split theo punctuation tiếng Trung:
     - `。`
     - `！`
     - `？`
     - `；`
4. Chỉ khi vẫn quá dài mới hard split.

Không làm mất ký tự.

---

## 21. Translator

Tạo `app/translator/translator.py`.

API:

```python
def translate_chapters(
    start: int | None = None,
    end: int | None = None,
    force: bool = False,
) -> None:
    ...
```

Logic:

1. Đọc sorted raw JSON.
2. Filter range.
3. Nếu translated JSON tồn tại + valid -> SKIP.
4. Dịch title riêng.
5. Split content.
6. Dịch từng chunk theo thứ tự.
7. Retry Gemini với exponential backoff.
8. Ghép chunks lại.
9. Save translated JSON atomic.
10. Log progress.

Không chạy song song aggressive ở version đầu tiên.

Ưu tiên sequential để kiểm soát quota.

---

## 22. Retry Gemini

Dùng `tenacity`.

Ví dụ behavior:

```text
attempt 1 fail
wait 2s

attempt 2 fail
wait 4s

attempt 3 fail
wait 8s

...
max wait 60s
max attempts 5
```

Retry các lỗi tạm thời.

Không retry vô hạn với:

- invalid API key
- model not found
- invalid request rõ ràng

Nếu quota hết trong ngày thì dừng job sạch sẽ và cho phép resume sau.

---

## 23. Chunk checkpoint

Nếu một chương có 8 chunks và fail ở chunk 7, lý tưởng là không dịch lại 1-6.

Tạo optional checkpoint:

```text
data/translated/.work/000123/
├── 0001.txt
├── 0002.txt
├── ...
```

Khi tất cả chunk xong:

1. Merge.
2. Save final JSON.
3. Xóa `.work/000123/`.

Nếu chưa muốn implement ngay, đánh dấu Phase 2 nhưng architecture không được cản trở việc thêm feature này.

---

## 24. CLI

Ưu tiên `argparse` để giảm dependency.

Các command:

### Crawl

```bash
python main.py crawl --url "BOOK_URL"
```

Range:

```bash
python main.py crawl --url "BOOK_URL" --start 1 --end 20
```

Force:

```bash
python main.py crawl --url "BOOK_URL" --start 1 --end 20 --force
```

### Translate

```bash
python main.py translate
```

Range:

```bash
python main.py translate --start 1 --end 20
```

Force:

```bash
python main.py translate --start 1 --end 20 --force
```

### Export

```bash
python main.py export --format txt --output output/book_vi.txt
```

### Status

```bash
python main.py status
```

Status hiển thị:

```text
Book chapters detected: 2534
Raw downloaded: 120
Translated: 87
Raw missing: 2414
Translation pending: 33
```

Nếu chưa biết total từ source thì hiển thị số đã biết.

---

## 25. Export TXT

Tạo `app/storage/exporter.py`.

TXT format:

```text
TÊN TRUYỆN

Chương 1: ...

Nội dung...

Chương 2: ...

Nội dung...
```

Export theo index tăng dần.

Nếu thiếu chương giữa dãy thì:

- warning rõ ràng
- không silently đổi số chương

Optional flag:

```bash
--allow-missing
```

Mặc định nên cảnh báo nhưng vẫn có thể export các chương hiện có.

---

## 26. Logging

Tạo log file:

```text
logs/app.log
```

Console format ví dụ:

```text
[CRAWL] 000001 OK 第一章 ...
[CRAWL] 000002 SKIP
[CRAWL] 000003 ERROR timeout

[TRANSLATE] 000001 chunk 1/4
[TRANSLATE] 000001 chunk 2/4
[TRANSLATE] 000001 OK
```

Không log toàn bộ chapter content.

Không log API key.

---

## 27. Error handling

Các lỗi cần xử lý rõ:

### Network

```text
timeout
connection reset
DNS error
5xx
```

=> retry giới hạn.

### 429

=> backoff.

### 401/403

=> báo access denied và không bypass.

### Parser

Nếu:

```text
title == None
content == None
```

=> lưu log URL + selector failure.

Không lưu raw JSON rỗng như thành công.

### Gemini

- API key invalid
- model unavailable
- rate limit
- response empty
- safety refusal
- network failure

Tất cả phải có message dễ hiểu.

---

## 28. Config

Tạo `app/config.py`.

Dùng dataclass:

```python
@dataclass
class Settings:
    gemini_api_key: str
    gemini_model: str
    request_delay_min: float
    request_delay_max: float
    request_timeout: int
    max_translate_chars: int
```

Load `.env` một lần.

Không gọi `load_dotenv()` rải rác nhiều module.

---

## 29. Test strategy

Không cần test framework phức tạp ban đầu, nhưng ít nhất phải có:

```text
tests/
├── test_parser.py
├── test_splitter.py
└── fixtures/
```

`test_splitter.py` phải verify:

```text
join(chunks) giữ đủ nội dung về mặt text
không chunk nào vượt limit quá nhiều
không mất punctuation
```

Parser test dùng saved HTML fixture, không request website thật mỗi lần test.

---

## 30. Development phases

### Phase 1 — Skeleton

Hoàn thành:

- project structure
- config
- CLI
- data models
- JSON storage
- logging

### Phase 2 — Single chapter crawl

Chỉ test 1 chapter.

Acceptance:

```text
HTTP 200
title đúng
content đúng
save JSON đúng UTF-8
```

### Phase 3 — Book index

Lấy được danh sách chương.

Acceptance:

```text
không duplicate
đúng thứ tự
URL absolute
```

### Phase 4 — Batch crawl

Test:

```text
1-10
```

Sau đó:

```text
1-100
```

Không test hàng nghìn chương ngay.

### Phase 5 — Gemini single chunk

Dịch một đoạn ngắn.

### Phase 6 — Gemini single chapter

Split + translate + merge.

### Phase 7 — Batch translation

Test 5-10 chương.

### Phase 8 — Resume/retry

Cố tình stop process rồi chạy lại.

Phải skip phần đã hoàn thành.

### Phase 9 — Export TXT

### Phase 10 — Optional GUI

Chỉ làm sau khi CLI ổn định.

---

## 31. Acceptance criteria

Project được xem là usable khi:

1. `python main.py crawl --url ... --start 1 --end 10`
   crawl thành công 10 chương hợp lệ.

2. Chạy lại command trên:
   không request lại chapter files đã tồn tại và hợp lệ.

3. `python main.py translate --start 1 --end 10`
   tạo 10 translated JSON.

4. Kill process giữa chương rồi chạy lại:
   tool tiếp tục được.

5. Gemini 429:
   tool backoff thay vì crash ngay.

6. API key sai:
   tool báo lỗi rõ ràng.

7. Parser fail:
   không ghi file chapter rỗng.

8. Unicode Trung + Việt:
   không lỗi font/encoding.

9. `python main.py export --format txt`
   tạo TXT đọc được.

10. Code module hóa:
   thay parser website không cần sửa Gemini translator.

---

## 32. Không làm ở phiên bản đầu

Không làm những thứ sau trừ khi người dùng yêu cầu:

- GUI.
- Database PostgreSQL/MySQL.
- Redis.
- Celery.
- Docker.
- Multi-thread crawl tốc độ cao.
- Proxy rotation.
- CAPTCHA solving.
- Cloud deployment.
- Authentication.
- TTS/audio generation.
- YouTube uploader.
- Web dashboard.

Giữ MVP đơn giản.

---

## 33. Coding style

- Python type hints.
- Function ngắn, rõ nhiệm vụ.
- Không tạo class nếu function đủ dùng.
- Không copy-paste logic.
- Không hardcode path lung tung.
- Dùng `pathlib.Path`.
- UTF-8 everywhere.
- Có docstring cho public functions.
- Variable/function dùng tiếng Anh.
- Log/messages CLI có thể dùng tiếng Việt hoặc tiếng Anh nhưng phải thống nhất.

---

## 34. README phải có

README cuối cùng cần ghi:

### Setup

```bash
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
```

Install:

```bash
pip install -r requirements.txt
```

Copy env:

```bash
copy .env.example .env
```

Điền:

```env
GEMINI_API_KEY=...
```

### Run crawler

```bash
python main.py crawl --url "..."
```

### Translate

```bash
python main.py translate
```

### Export

```bash
python main.py export --format txt --output output/book.txt
```

### Resume

Giải thích rõ rằng chạy lại cùng command sẽ skip chapter đã hoàn thành.

---

## 35. Yêu cầu khi Codex bắt đầu làm

Thứ tự làm việc:

1. Đọc toàn bộ file này.
2. Khởi tạo project skeleton.
3. Không viết toàn bộ project một lần.
4. Implement config + CLI + storage trước.
5. Sau đó kiểm tra cấu trúc HTML thực tế của source.
6. Implement parser dựa trên HTML thật, không đoán selector.
7. Test crawler 1 chapter.
8. Test 10 chapter.
9. Sau khi crawler ổn mới implement Gemini translator.
10. Sau translator mới implement exporter.
11. Luôn giữ project runnable sau mỗi phase.

Nếu một selector hoặc hành vi website chưa xác minh được, để TODO rõ ràng thay vì tự bịa.

---

## 36. Expected CLI UX

Ví dụ:

```text
$ python main.py crawl --url "https://example.com/book/123" --start 1 --end 5

Book: 太虚至尊
Detected chapters: 2534
Range: 1 -> 5

[1/5] Chapter 1 ... OK
[2/5] Chapter 2 ... OK
[3/5] Chapter 3 ... SKIP
[4/5] Chapter 4 ... OK
[5/5] Chapter 5 ... OK

Finished
Success: 4
Skipped: 1
Failed: 0
```

Translate:

```text
$ python main.py translate --start 1 --end 5

Model: gemini-2.5-flash
Glossary entries: 24

[1/5] Chapter 1
  chunk 1/3 ... OK
  chunk 2/3 ... OK
  chunk 3/3 ... OK
  saved

...

Finished
Translated: 5
Skipped: 0
Failed: 0
```

---

## 37. Future extensions

Architecture nên cho phép thêm sau:

```text
source adapters
multiple novels
SQLite index
translation quality review
glossary extraction bằng Gemini
TTS
audio chapter generator
web UI
FastAPI
desktop GUI
```

Nhưng không implement cho đến khi MVP hoạt động ổn định.

---

## 38. Ưu tiên cuối cùng

Theo thứ tự:

```text
Correctness
> Resume safety
> Maintainability
> Rate-limit safety
> Speed
```

Không tối ưu tốc độ trước khi crawler và translator chính xác.
