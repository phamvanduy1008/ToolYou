# Kế hoạch crawl an toàn và chính xác — Thái Hư Chí Tôn

Ngày lập kế hoạch: 2026-10-06

> Trạng thái triển khai: các lệnh catalogue, staging, audit và commit mô tả trong tài liệu này đã được triển khai ngày 2026-10-06. Các canary chương 301, 400, 401, 500, 501 đã được crawl vào staging, kiểm định H1/số trang/tỷ lệ Hán/SimHash, audit 0 lỗi (đối chiếu Yuewen/Qidian) và commit thành công vào raw.

## 1. Mục tiêu

Crawl lại **Thái Hư Chí Tôn** (`太虚至尊`, tác giả `苍天霸主`) theo đúng số chương, không lẫn truyện, không ghi đè dữ liệu tốt bằng trang lỗi và có đủ bằng chứng để truy ngược mỗi file về URL nguồn.

Phạm vi trước mắt:

- Giữ lại raw đã kiểm tra: chương `1–166` và `168–300`.
- Crawl lại chương `167` và từ `301` trở đi.
- Không dịch chương mới cho đến khi chương đó vượt qua toàn bộ kiểm định raw.

## 2. Nguồn và vai trò của từng nguồn

### Nguồn crawl nội dung chính

- 97du: <https://www.97du.cc/105/105308/>
- Trang này hiện nhận diện sách là `太虚至尊`, tác giả `苍天霸主`, nhân vật mở đầu là `江凡` và `许怡宁`.
- Catalogue 97du tại thời điểm kiểm tra hiển thị **2.509 chương**, chương cuối là `第2509章 灭圣伞`.

Không dùng URL <https://www.97du.cc/134/134799/> vì đó là một truyện khác.

### Nguồn tham chiếu chính thức

- Qidian, book ID `1038440253`: <https://www.qidian.com/book/1038440253/>
- Catalogue Qidian: <https://www.qidian.com/chapter/1038440253/catalog/>
- Trang thuộc hệ Yuewen xác nhận tên sách, tác giả và liên kết về Qidian: <https://www.xs.cn/bookquery/enkgos>

Qidian/Yuewen dùng để xác nhận danh tính sách, tác giả, số chương và tiêu đề. Không dựa vào một mirror duy nhất để quyết định rằng nội dung đã đúng.

### Nguồn tham chiếu độc lập

- Mirror catalogue: <https://www.bqgns.com/book/52413>

Nguồn này xác nhận chuỗi tiêu đề đầu sách, ví dụ chương 1 `姐姐替嫁`, chương 2 `神秘的种子`, chương 100 `不见棺材不落泪`. Chỉ dùng để đối chiếu; không tự động thay thế nguồn chính khi hai nguồn bất đồng.

## 3. Hiện trạng và nguyên nhân sự cố

### Hiện trạng dữ liệu

- `data/raw/Thai_Hu_Chi_Ton` hiện còn 299 file: `1–166` và `168–300`.
- Chương 167 đã bị loại vì trang 97du chỉ trả thông báo kiểu `正在手打中，请稍等片刻` thay vì nội dung chương.
- Các file từ 301 trở đi đã bị loại vì crawler cũ gán số file theo thứ tự khám phá trang catalogue, không theo số `第N章`.
- `data/book.json` hiện đang trỏ tới một sách khác (`谁教他这么修仙的？` trên `biquge321.com`). Không được dùng metadata này để crawl Thái Hư Chí Tôn.

### Những phần code hiện tại đã đúng

- `app/crawler/crawler.py` hiện đã sắp xếp catalogue 97du theo số lấy từ `第N章`.
- Có ghi file nguyên tử qua `atomic_write_text`.
- HTTP client kiểm tra `robots.txt`, có timeout, backoff và tôn trọng `Retry-After`.
- Parser có ghép các trang con của một chương.

### Những lỗ hổng cần đóng trước khi crawl lớn

1. `valid_chapter_text()` chỉ kiểm tra nội dung dài hơn 100 ký tự; trang sai truyện vẫn được coi là hợp lệ.
2. File raw không lưu URL nguồn, tiêu đề, hash hoặc thời gian crawl nên không thể truy vết.
3. `_fetch_complete_chapter()` chưa xác nhận số chương trong H1 khớp với số catalogue.
4. Các trang con chưa được kiểm tra cùng thuộc một chương trước khi ghép.
5. Chưa chặn các câu báo lỗi/placeholder của website.
6. Chưa phát hiện một nội dung bị website trả cho nhiều URL khác nhau.
7. Crawler cập nhật `data/book.json` và chọn thư mục theo metadata đang hoạt động; điều này có thể route dữ liệu sang nhầm sách.
8. Chưa có vùng staging và báo cáo kiểm định trước khi đưa file vào raw chính.

## 4. Thiết kế an toàn đề xuất

### 4.1. Khóa danh tính sách

Tạo cấu hình riêng cho lần crawl, không suy ra thư mục đích từ `data/book.json` đang dùng chung:

```json
{
  "book_key": "Thai_Hu_Chi_Ton",
  "title_cn": "太虚至尊",
  "title_vi": "Thái Hư Chí Tôn",
  "author_cn": "苍天霸主",
  "primary_catalogue_url": "https://www.97du.cc/105/105308/",
  "qidian_book_id": "1038440253"
}
```

CLI cần có `--book Thai_Hu_Chi_Ton` hoặc `--output-book Thai_Hu_Chi_Ton`; không để URL mới tự đổi thư mục dựa trên metadata cũ.

Trước khi crawl, bắt buộc xác nhận trên HTML catalogue:

- Tên sách chứa `太虚至尊`.
- Tác giả là `苍天霸主` nếu trang có trường tác giả.
- Mô tả hoặc chương đầu khớp các tên neo `江凡`, `许怡宁`.
- URL sau redirect vẫn cùng domain và cùng book path `/105/105308/`.

Sai một điều kiện thì dừng toàn bộ job, không tải chương.

### 4.2. Chụp catalogue thành manifest bất biến

Trước khi tải nội dung, tải hết các trang catalogue rồi tạo:

`data/manifests/Thai_Hu_Chi_Ton/catalogue-YYYYMMDD.json`

Mỗi bản ghi gồm:

```json
{
  "chapter": 301,
  "title": "第301章 ...",
  "url": "https://www.97du.cc/105/105308/....html",
  "catalogue_page": ".../index_4.html"
}
```

Quy tắc:

- Số file luôn lấy từ regex `第\s*(\d+)\s*章`, tuyệt đối không lấy vị trí link hay thứ tự BFS.
- Sắp xếp các trang catalogue theo chỉ số `index_N`, sau đó vẫn sắp chương theo số chương tường minh.
- URL chương phải duy nhất và thuộc đúng `/105/105308/`.
- Một số chương không được ánh xạ tới hai URL khác nhau.
- Báo lỗi rõ ràng khi có số trùng, số thiếu, tiêu đề không có `第N章` hoặc catalogue đột ngột giảm số chương.
- Lưu hash SHA-256 của toàn bộ snapshot catalogue để lần resume dùng đúng một phiên bản danh sách.

Không crawl nội dung nếu manifest catalogue chưa vượt qua kiểm định.

### 4.3. Đối chiếu catalogue với nguồn tham chiếu

Tạo `reference-catalogue.json` từ Qidian/Yuewen khi truy cập được. Với mỗi chương cần crawl:

- Chuẩn hóa khoảng trắng và dấu câu trong tiêu đề.
- So số chương và tiêu đề giữa 97du với Qidian/Yuewen.
- Dùng mirror độc lập làm phiếu kiểm tra thứ ba khi hai nguồn đầu bất đồng.

Phân loại:

- `verified`: số và tiêu đề khớp ít nhất hai nguồn.
- `primary_only`: chỉ 97du có dữ liệu; được crawl nhưng cần kiểm định nội dung chặt hơn.
- `conflict`: số hoặc tiêu đề mâu thuẫn; không tự động commit.
- `missing`: thiếu ở catalogue chính; không tự dịch chuyển số của các chương sau.

Các chương thông báo, xin nghỉ hoặc bị gỡ trên nguồn chính thức phải được đánh dấu riêng; không ép chúng thành chương truyện.

### 4.4. Tải vào staging, không ghi thẳng vào raw

Mọi response trước tiên được lưu ở:

`data/staging/Thai_Hu_Chi_Ton/<run-id>/<chapter>/`

Lưu cả HTML gốc của trang đầu và các trang con để điều tra khi parser sai. Chỉ sau khi kiểm định thành công mới tạo file text tạm và atomic replace sang:

`data/raw/Thai_Hu_Chi_Ton/<chapter>.txt`

Nếu request hoặc validation thất bại:

- Giữ nguyên raw cũ nếu có.
- Ghi trạng thái `failed` hoặc `quarantined` vào manifest.
- Không để file `.tmp` trở thành raw hợp lệ.

### 4.5. Kiểm định từng chương trước khi commit

Một chương chỉ được commit khi tất cả điều kiện sau đều đạt:

1. HTTP thành công, content type là HTML và URL cuối vẫn thuộc đúng sách.
2. H1 có `第N章` và `N` đúng bằng số chương trong manifest.
3. Tiêu đề H1 khớp tiêu đề catalogue sau khi chuẩn hóa.
4. Mọi trang con đều có cùng số chương; số trang nhận được đủ từ `1..page_count`.
5. Nội dung sau làm sạch dài hơn ngưỡng tối thiểu động, không chỉ cố định 100 ký tự.
6. Tỷ lệ chữ Hán hợp lý; không phải HTML, JavaScript, CAPTCHA hoặc trang chặn truy cập.
7. Không chứa marker lỗi, ví dụ:
   - `正在手打中`
   - `请稍等片刻`
   - `内容更新后，请重新刷新页面`
   - `章节内容正在更新`
   - `404` / `页面不存在`
8. Không trùng SHA-256 với một chương khác. Nếu gần trùng theo SimHash/MinHash thì đưa vào quarantine.
9. Không có tiêu đề/tên sách của nguồn khác trong H1, breadcrumb hoặc metadata.
10. Với các chương bị nghi ngờ, kiểm tra các tên neo của truyện và tính liên tục với chương trước/sau; đây là tín hiệu cảnh báo, không phải điều kiện cứng vì một chương có thể không nhắc nhân vật chính.

Không nên dùng model AI làm bộ kiểm định duy nhất. Các kiểm tra quyết định commit phải có tính xác định và tái lập được.

### 4.6. Manifest cấp chương

Tạo `data/manifests/Thai_Hu_Chi_Ton/chapters.jsonl`, mỗi dòng gồm tối thiểu:

```json
{
  "chapter": 301,
  "catalogue_title": "第301章 ...",
  "page_title": "第301章 ...",
  "source_url": "https://www.97du.cc/105/105308/....html",
  "final_url": "https://www.97du.cc/105/105308/....html",
  "subpage_urls": [],
  "content_sha256": "...",
  "content_chars": 2345,
  "han_ratio": 0.82,
  "catalogue_snapshot_sha256": "...",
  "status": "verified",
  "checks": [],
  "crawled_at": "..."
}
```

Manifest phải được ghi nguyên tử. Resume chỉ `SKIP` khi cả file raw lẫn bản ghi manifest đều tồn tại, hash khớp và trạng thái là `verified`.

### 4.7. Retry và tốc độ

- Một worker crawl là mặc định; website đã từng timeout và trả 502 nên không nên song song mạnh.
- Giữ delay ngẫu nhiên tối thiểu 2–4 giây/request và tôn trọng `robots.txt`/`Retry-After`.
- Retry riêng cho timeout, 429 và 5xx bằng exponential backoff có jitter.
- Không retry 404, trang sai H1 hoặc placeholder quá 1 lần trong cùng lượt chạy.
- Sau 3 lỗi liên tiếp cùng loại, mở circuit breaker và dừng job để tránh lưu hàng loạt trang sai.
- Giới hạn mỗi batch 25–50 chương; nghỉ và audit trước batch tiếp theo.

### 4.8. Audit theo batch và kiểm tra liên tục

Sau mỗi batch, sinh báo cáo Markdown/JSON có:

- Chương thành công, thiếu, conflict và quarantine.
- Mapping `chapter -> title -> source URL -> SHA-256`.
- Khoảng trống số chương.
- Hash trùng và nội dung gần trùng.
- Outlier độ dài so với median 20 chương lân cận.
- Mẫu 200 ký tự đầu/cuối để con người kiểm nhanh.

Chọn canary tại ranh giới catalogue: `1`, `100`, `101`, `200`, `201`, `300`, `301`, `400`, ... và chương cuối. Chỉ chạy batch lớn sau khi các canary đều đúng số và tiêu đề trên ít nhất hai nguồn.

## 5. Trình tự triển khai

### Giai đoạn A — sửa công cụ

1. Thêm `--book`/`--output-book` cho lệnh crawl, tách khỏi `data/book.json` toàn cục.
2. Thêm snapshot catalogue và manifest cấp chương.
3. Thêm validator số chương, tiêu đề, subpage, marker lỗi, hash trùng và độ dài bất thường.
4. Thêm staging/quarantine và chỉ atomic commit sau validation.
5. Thêm lệnh `crawl-audit` chỉ đọc, không tải lại và không xóa file.
6. Viết test fixture cho thứ tự catalogue 97du từng gây lỗi: `index_26` xuất hiện trước `index_4` nhưng chương vẫn phải là 301, 302, ...
7. Viết test cho trang 167 dạng placeholder, H1 sai chương, subpage thiếu và hai URL trả cùng nội dung.

### Giai đoạn B — thử nghiệm nhỏ

1. Snapshot toàn bộ catalogue và đối chiếu tiêu đề.
2. Crawl canary `301`, `400`, `401`, `500`, `501` vào staging.
3. Kiểm tra thủ công report, URL và 200 ký tự đầu/cuối.
4. Chỉ khi canary đạt mới crawl `301–350`.

### Giai đoạn C — crawl lại có kiểm soát

1. Crawl theo batch 50 chương: `301–350`, `351–400`, ...
2. Sau mỗi batch chạy audit và chỉ tiếp tục khi không có `conflict`/`quarantined` chưa xử lý.
3. Chương 167 xử lý riêng: nếu 97du vẫn là placeholder, lấy tiêu đề từ catalogue và chỉ dùng nội dung từ nguồn khác khi hai nguồn tham chiếu khớp; manifest phải ghi rõ nguồn thay thế.
4. Không dùng `--force` trên toàn bộ thư mục. Chỉ force một danh sách chương cụ thể đã được xác minh.

### Giai đoạn D — trước khi dịch

1. Yêu cầu đủ manifest `verified` cho toàn bộ raw được chọn.
2. Xóa hoặc rebuild trạng thái glossary của các chương raw cũ đã sai (`301+`).
3. Xóa/dịch lại các file v2 tương ứng vì bản dịch cũ được tạo từ raw sai.
4. Chạy audit raw lần cuối rồi mới chạy glossary discovery và translation.

## 6. CLI đã triển khai

Quy trình cho mỗi batch tối đa 50 chương:

```powershell
python main.py crawl-catalogue --book Thai_Hu_Chi_Ton --url "https://www.97du.cc/105/105308/"
python main.py crawl --book Thai_Hu_Chi_Ton --start 301 --end 350 --staging --continue-on-error
python main.py crawl-audit --book Thai_Hu_Chi_Ton --start 301 --end 350 --reference qidian
python main.py crawl-commit --book Thai_Hu_Chi_Ton --start 301 --end 350
```

Nếu một chương lỗi, mặc định batch dừng ngay; thêm `--continue-on-error` để tiếp tục, nhưng circuit breaker vẫn dừng sau ba lỗi liên tiếp cùng loại.

Snapshot hiện tại:

- 2.506 mục nội dung trên dải chương `1–2509`.
- SHA-256 catalogue: `07c97800574a4e9e15e78d6f4038a96358e51386ed28fe83a3aabd08638f8a25`.
- Hai mục trùng `1125`, `1192` đã giữ URL có tiêu đề đầy đủ và ghi lại URL bị loại trong anomaly.
- Ba số thiếu `1333`, `1431`, `2415` là thông báo của tác giả bị 97du lược bỏ, không dịch chuyển số chương sau.
- Chương `2289` được giữ đúng số dù 97du ghi `第2289 异变` thiếu chữ `章`.
- Đối chiếu Yuewen khớp 2.502 tiêu đề. Chương `1896` khác tên rút gọn (`开光` / `小皮鞭开光`) đã được xác minh thủ công và lưu thành override có lý do trong cấu hình; các conflict khác vẫn bị quarantine.

## 7. Tiêu chí hoàn thành

Một đợt crawl được xem là an toàn khi:

- 100% file raw có manifest và URL nguồn.
- 100% số chương trong H1 khớp tên file.
- Không có gap ngoài danh sách được giải thích rõ.
- Không có placeholder, hash trùng hoặc trang lẫn sách.
- Mỗi chương có SHA-256 và catalogue snapshot để tái kiểm tra.
- Lỗi mạng hoặc Ctrl+C không làm mất raw tốt và không tạo file hợp lệ giả.
- Có report cho phép kiểm tra lại mà không cần tin vào log console.

## 8. Kết luận thực thi

Không dùng luồng crawl legacy cho `301–2509`. Luồng an toàn đã triển khai phải được chạy theo thứ tự: **khóa danh tính sách → snapshot catalogue → đối chiếu nguồn → crawl staging theo batch → audit → commit raw → rebuild glossary → dịch lại**.

Nguồn tham chiếu có thể thay đổi theo thời gian; vì vậy mọi lần crawl phải lưu snapshot, timestamp và hash thay vì chỉ dựa vào trạng thái live của website.
