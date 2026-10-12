# Crawl Thai Co Than Ton

Crawler nay doc raw HTML tu `truyendocviet.shop`, parse `window.__INITIAL_DATA__`, lay noi dung chuong trong `chapterInfo.Description` va link chuong sau tu `nextChapterInfo._id`.

## Cai dat

```powershell
cd D:\Code\TTS\cawl\crawl_thai_co_than_ton
npm install
```

## Chay

```powershell
node crawler.js
```

## Chay thu 5 chuong

Sua `maxChapters` trong `config.js` thanh:

```js
maxChapters: 5
```

Sau do chay:

```powershell
node crawler.js
```

Hoac chay tam thoi 1 lan bang bien moi truong:

```powershell
$env:MAX_CHAPTERS='5'; node crawler.js
```

## Chay tiep sau khi bi dung

```powershell
node crawler.js
```

Crawler se doc `progress.json`, bo qua URL da hoan thanh va tiep tuc tu `nextUrl`.

## Reset tien do

Xoa `progress.json` va thu muc output cua truyen:

```powershell
Remove-Item .\progress.json
Remove-Item .\output\thai-co-than-ton -Recurse
```

## File dau ra

Moi chuong duoc luu rieng:

```text
output/thai-co-than-ton/0001 - Chuong 01 - Thai tu trung sinh.txt
```

File tong:

```text
output/thai-co-than-ton/all_chapters.txt
```

Neu loi, debug duoc luu vao:

```text
debug/
```
