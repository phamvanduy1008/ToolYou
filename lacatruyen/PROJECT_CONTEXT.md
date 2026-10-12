# Lacatruyen Crawler - Project Context

File này dùng để đọc nhanh bối cảnh dự án ở các lần làm việc sau, tránh phải đọc lại toàn bộ code.

## Mục tiêu

- Crawl truyện `Thanh Sơn` trên `https://lacatruyen.vip/`.
- Tác giả: `Hội Thuyết Thoại Đích Trửu Tử`.
- Tổng dự kiến: khoảng `726` chương.
- Lưu nội dung chương dạng `.txt` để dùng cho TTS.
- Không dùng Selenium/Playwright nếu không cần; ưu tiên đọc HTML/Next.js data trực tiếp.

## Cấu trúc chính

```text
lacatruyen/
  index.js
  config.js
  src/
    fetchPage.js
    decrypt.js
    chapter.js
    save.js
  novels/
    thanh-son/
      .progress.json
      chuong-001-050.txt
      chuong-051-100.txt
      ...
```

## Cách chạy

```powershell
cd D:\Code\TTS\cawl\lacatruyen
npm.cmd start
```

Chạy thử vài chương:

```powershell
npm.cmd start -- --limit 5
```

Chạy lại một đoạn và ghi đè file batch tương ứng:

```powershell
npm.cmd start -- --from 101 --to 150 --force true
```

Bắt đầu crawl từ một chương cụ thể:

```powershell
npm.cmd start -- --start 34
npm.cmd start -- --start-chapter 34
```

Hoặc đặt mặc định bằng biến môi trường:

```powershell
$env:START_CHAPTER="34"
npm.cmd start
```

Nếu cần cookie đăng nhập:

```powershell
$env:COOKIE="cookie_lay_tu_trinh_duyet"
npm.cmd start
```

Nếu chỉ muốn lấy `previewHtml` từ `__NEXT_DATA__` và bỏ qua decrypt AES cho nhanh:

```powershell
npm.cmd start -- --preview-only true
```

Nếu muốn ưu tiên `previewHtml` sạch, nhưng vẫn fallback decrypt khi preview không dùng được:

```powershell
npm.cmd start -- --prefer-preview true
```

Mặc định crawler sẽ bỏ qua chương lỗi và đi tiếp chương sau. Nếu muốn gặp lỗi là dừng:

```powershell
npm.cmd start -- --continue-on-error false
```

Biến môi trường tương ứng:

```powershell
$env:PREVIEW_ONLY="true"
$env:PREFER_PREVIEW="true"
```

Nếu muốn đổi số chương mỗi file:

```powershell
$env:CHAPTERS_PER_FILE="50"
npm.cmd start
```

Audit từ chương 100 để tìm batch còn mã hóa/rác hoặc chương thiếu:

```powershell
npm.cmd run audit -- --start 100
```

Script audit sẽ in ra lệnh nên chạy lại theo từng batch, ví dụ:

```powershell
npm.cmd start -- --start 101 --to 150 --force true
```

## Config quan trọng

Trong `config.js`:

- `baseUrl`: `https://lacatruyen.vip`
- `novelSlug`: `thanh-son`
- `novelTitle`: `Thanh Sơn`
- `author`: `Hội Thuyết Thoại Đích Trửu Tử`
- `startUrl`: `https://lacatruyen.vip/chapter/Chuong-1-Ve-So-Khong-6944`
- `expectedChapterCount`: `726`
- `outputDir`: `novels/thanh-son`
- `chaptersPerFile`: mặc định `50`
- `delayMs`: mặc định `900`
- `cookie`: lấy từ biến môi trường `COOKIE`

## Luồng crawl hiện tại

1. `index.js` bắt đầu từ `config.startUrl`.
2. `src/fetchPage.js` dùng `axios` tải HTML, parse `script#__NEXT_DATA__` bằng `cheerio`.
3. `props.pageProps.chapter` chứa dữ liệu chương hiện tại.
4. `props.pageProps.chapterRight.slug` được dùng để đi sang chương tiếp theo.
5. `props.pageProps.chapterLeft.slug` là chương trước.
6. `props.pageProps.rs` không phải danh sách chương; nó là map/key data phục vụ giải mã.
7. Nội dung sau khi lấy được sẽ qua `htmlToText()`, bỏ HTML, làm sạch text.
8. `formatChapterText()` bỏ dòng tiêu đề kiểu `Chương 001: Về Số Không`.
9. `src/save.js` lưu 50 chương vào 1 file batch.

## Output hiện tại

Mỗi file chứa 50 chương:

```text
novels/thanh-son/chuong-001-050.txt
novels/thanh-son/chuong-051-100.txt
novels/thanh-son/chuong-101-150.txt
...
```

Từ bản sửa mới, crawler còn lưu cache từng chương:

```text
novels/thanh-son/.chapters/chuong-001.txt
novels/thanh-son/.chapters/chuong-002.txt
...
```

File gộp 50 chương được rebuild từ cache theo đúng thứ tự. Vì vậy chạy lại một chương sẽ thay đúng chương đó trong cache rồi ghép lại file batch đúng vị trí:

```powershell
npm.cmd start -- --start 34 --to 34 --force true
```

Nếu muốn làm sạch output cũ và tạo cache mới từ đầu:

```powershell
npm.cmd start -- --start 1 --force true
```

Không thêm heading chương vào file. Ví dụ dòng `Chương 001: Về Số Không` đã bị loại bỏ theo yêu cầu.

Tiến trình đã lưu được ghi trong:

```text
novels/thanh-son/.progress.json
```

Nhờ file này, crawler có thể chạy lại và bỏ qua chương đã lưu, trừ khi dùng `--force true`.

Mỗi chương trong `.progress.json` có thể có thêm vị trí dòng trong file batch:

```json
{
  "34": {
    "file": "chuong-001-050.txt",
    "cache": ".chapters/chuong-034.txt",
    "lines": {
      "lineStart": 1234,
      "lineEnd": 1298
    }
  }
}
```

`lineStart` và `lineEnd` là vị trí của chương đó trong file gộp tương ứng. Vị trí này được tính lại mỗi lần rebuild batch.

## Reverse Next.js data

Website là Next.js. Dữ liệu chính nằm trong:

```html
<script id="__NEXT_DATA__" type="application/json">
```

Các field đã thấy:

- `props.pageProps.chapter`
- `chapter.content`
- `chapter.content_comp`
- `chapter.key_encrypt`
- `props.pageProps.rs`
- `props.pageProps.count_chapter`
- `props.pageProps.chapterRight`
- `props.pageProps.chapterLeft`
- `props.pageProps.previewHtml`

File JS Next.js từng được nhắc tới:

```text
_next/static/chunks/pages/chapter/[slug]-23002899bbde773c.js
```

Cần tìm các đoạn liên quan:

- `CryptoJS.AES.decrypt`
- `key_encrypt`
- `content_comp`

## Decrypt và fallback

Nội dung có dạng AES CryptoJS, thường bắt đầu bằng:

```text
U2FsdGVkX1...
```

Với truyện này, `story.lock = login` và `story.not_free = true`, nên giải mã full content có thể không ổn nếu thiếu session/cookie hợp lệ.

Crawler hiện có fallback:

1. Thử resolve/decrypt nội dung từ `chapter.content` / `content_comp`.
2. Chuyển HTML sang text.
3. Kiểm tra text có đọc được không bằng `isLikelyReadableText()`.
4. Nếu text sau decrypt bị rác hoặc binary, thử dùng `pageProps.previewHtml`.
5. Nếu vẫn không đọc được, throw lỗi và không lưu chương đó.

## Chống lưu dữ liệu rác

Trước đây có một số chương bị lưu thành ký tự binary/rác do nội dung decrypt không hợp lệ nhưng vẫn được ghi ra file.

Hiện đã thêm guard trong `src/chapter.js`:

- Chặn text bắt đầu bằng `U2FsdGVkX1`.
- Chặn ký tự replacement `�`.
- Chặn control characters.
- Kiểm tra tỷ lệ chữ cái và ký tự lạ.

Trong `index.js`, nếu nội dung decrypt không đọc được:

- Ưu tiên fallback sang `previewHtml` nếu preview sạch.
- Nếu không có preview sạch thì báo lỗi và không lưu.

## Lưu ý trạng thái hiện tại

Một số file batch đã được sinh trước khi có guard chống dữ liệu rác, nên có thể vẫn chứa đoạn lỗi. Nên regenerate các batch nghi ngờ bằng `--force true`.

Các batch từng phát hiện có ký tự rác trong lần scan trước:

```text
chuong-001-050.txt
chuong-101-150.txt
chuong-151-200.txt
chuong-201-250.txt
chuong-251-300.txt
```

Lưu ý đặc biệt: lần test gần nhất đã chạy:

```powershell
npm.cmd start -- --limit 1 --force true
```

Việc này đã reset `chuong-001-050.txt` và chỉ ghi lại chương 1. Nếu cần khôi phục đủ batch đầu, chạy:

```powershell
npm.cmd start -- --to 50 --force true
```

## File chịu trách nhiệm

- `index.js`: điều phối crawl, parse CLI args, loop chương, retry, delay, log tiến trình.
- `config.js`: cấu hình site, truyện, output, delay, cookie.
- `src/fetchPage.js`: request HTML, parse `__NEXT_DATA__`, gắn headers/cookie.
- `src/decrypt.js`: logic thử giải mã AES/CryptoJS.
- `src/chapter.js`: lấy chapter từ pageProps, resolve content, HTML -> text, bỏ heading, kiểm tra text rác.
- `src/save.js`: lưu cache từng chương trong `.chapters`, rebuild batch 50 chương/file, quản lý `.progress.json`.

## Gợi ý khi làm tiếp

- Nếu muốn lấy full chương thay vì preview, cần login cookie hợp lệ hoặc reverse tiếp logic key trong JS bundle.
- Sau khi thêm cookie, nên test lại 1 chương bị rác trước:

```powershell
npm.cmd start -- --from 151 --to 151 --force true
```

- Nếu chương test sạch, regenerate cả batch:

```powershell
npm.cmd start -- --from 151 --to 200 --force true
```

- Không nên tin các file output cũ trước khi có guard; hãy regenerate batch quan trọng.
