# truyendich-crawler

Crawler TypeScript cho cac chuong truyen cong khai tu `https://truyendich.live/`.

Phien ban nay luu tung chuong ra file TXT va dung `data/progress.json` de resume. Khong dung database.

## Cai dat tren Windows

```powershell
npm.cmd install
npx playwright install chromium
copy .env.example .env
```

## Lenh chinh

```powershell
npm.cmd run dev -- inspect --url "https://truyendich.live/doc-truyen/cuu-vuc-pham-tien"
npm.cmd run dev -- crawl --url "https://truyendich.live/doc-truyen/cuu-vuc-pham-tien" --start 1 --end 10
npm.cmd run dev -- resume
npm.cmd run dev -- status
npm.cmd run dev -- retry-failed
```

Crawler chay tuan tu mot chuong tai mot thoi diem. Khoa `data/crawler.lock` ngan nhieu crawler cung chay va tranh lam hong checkpoint/browser profile. Neu gap CAPTCHA/challenge, crawler cho theo `CHALLENGE_WAIT_SECONDS`, sau do dong browser va cooldown truoc khi thu lai; code khong tu giai hoac vuot CAPTCHA.

`npm.cmd run watch` chay crawler duoi watchdog. Watchdog chi restart khi crawler that su bi treo hoac thoat loi, va tren Windows se dong toan bo cay process de khong sot lai cac tien trinh `node`/Chromium cu.
