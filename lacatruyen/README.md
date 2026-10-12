# lacatruyen-crawler

Crawler Node.js cho `lacatruyen.vip`, đọc dữ liệu Next.js trong:

```html
<script id="__NEXT_DATA__" type="application/json">
```

Tool lấy `props.pageProps.chapter`, dò JS chunk của Next.js, thử key quanh `CryptoJS.AES.decrypt`, `key_encrypt`, `content_comp`, giải mã AES bằng `crypto-js`, chuyển HTML sang text sạch rồi lưu từng chương vào:

```text
novels/
└── thanh-son/
    ├── chuong-001.txt
    ├── chuong-002.txt
    └── ...
```

## Cài đặt

```bash
cd lacatruyen
npm install
```

## Chạy

Mặc định tool dùng seed:

```text
https://lacatruyen.vip/chapter/thanh-son-chuong-1
```

Nếu slug thực tế khác, truyền URL chương đầu:

```bash
npm start -- --url "https://lacatruyen.vip/chapter/slug-chuong-1"
```

Chạy thử vài chương:

```bash
npm start -- --url "https://lacatruyen.vip/chapter/slug-chuong-1" --limit 5
```

Chạy tiếp từ chương 100:

```bash
npm start -- --from 100
```

Có thể dùng tham số dễ nhớ hơn để bắt đầu từ một chương cụ thể:

```bash
npm start -- --start 34
npm start -- --start-chapter 34
```

Hoặc đặt bằng biến môi trường:

```bash
START_CHAPTER=34 npm start
```

Ghi đè file đã có:

```bash
npm start -- --force true
```

Nếu chỉ muốn lấy `previewHtml` từ `__NEXT_DATA__` và bỏ qua decrypt AES cho nhanh:

```bash
npm start -- --preview-only true
```

Nếu muốn ưu tiên `previewHtml` sạch, nhưng vẫn fallback decrypt khi preview không dùng được:

```bash
npm start -- --prefer-preview true
```

Mặc định crawler sẽ bỏ qua chương lỗi và đi tiếp chương sau. Nếu muốn gặp lỗi là dừng:

```bash
npm start -- --continue-on-error false
```

Kiểm tra từ chương 100 xem batch nào còn mã hóa/rác hoặc chương nào thiếu:

```bash
npm run audit -- --start 100
```

Script audit sẽ in ra các lệnh `npm.cmd start -- --start ... --to ... --force true` nên chạy lại cho từng batch lỗi.

Từ bản sửa hiện tại, crawler luôn lưu thêm cache từng chương trong:

```text
novels/thanh-son/.chapters/chuong-001.txt
```

File gộp 50 chương sẽ được rebuild lại từ cache theo đúng thứ tự. Vì vậy chạy lại một chương sẽ sửa đúng vị trí trong file batch:

```bash
npm start -- --start 34 --to 34 --force true
```

`.progress.json` cũng lưu dòng bắt đầu/kết thúc của mỗi chương trong file batch:

```json
"34": {
  "file": "chuong-001-050.txt",
  "cache": ".chapters/chuong-034.txt",
  "lines": { "lineStart": 1234, "lineEnd": 1298 }
}
```

Nếu muốn crawl lại từ đầu để tạo cache sạch:

```bash
npm start -- --start 1 --force true
```

## Cấu hình quan trọng

Có thể chỉnh trong `config.js` hoặc qua biến môi trường:

```bash
START_URL="https://lacatruyen.vip/chapter/slug-chuong-1" npm start
DECRYPT_KEY="key-neu-phai-nhap-tay" npm start
DELAY_MS=1500 RETRIES=5 npm start
```

Nếu không parse được `rs`, tool fallback sang:

```text
CHAPTER_URL_PATTERN=https://lacatruyen.vip/chapter/thanh-son-chuong-{n}
EXPECTED_CHAPTER_COUNT=726
```

## Ghi chú reverse Next.js

Luồng chính:

1. Request HTML bằng `axios`.
2. Parse `script#__NEXT_DATA__` bằng `cheerio`.
3. Lấy `props.pageProps.chapter`.
4. Tải các JS chunk `_next/static/chunks/pages/chapter/...js`.
5. Dò các đoạn `CryptoJS.AES.decrypt(...)`, `key_encrypt`, `content_comp` để lấy key ứng viên.
6. Thử giải mã `chapter.content`, `chapter.content_comp`, `chapter.rs`.
7. Chuyển HTML sang text và lưu file `.txt`.

Nếu website đổi thuật toán key, mở JS chunk chương và tìm `AES.decrypt`, sau đó đặt key bằng `DECRYPT_KEY`.
