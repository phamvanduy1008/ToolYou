# Huong Dan Fix Loi Chuong Bi Ky Tu Rac

Tai lieu nay dung cho loi chuong crawl ra toan ky tu la nhu:

```text
𓂀𓃀𓇋𓏏...
饟個饟儉饟噵...
```

Day thuong la noi dung rac/anti-bot do website tra ve sai noi dung. Khong nen merge cac chuong nay vao file tong.


"64, 68-69, 84-85, 89-90, 92, 94-96, 109-110,
128-129, 133-134, 138-139, 143-144, 154-156,
160, 163, 167, 172, 175, 177, 181-183, 187,
195-196, 199, 209, 217-219, 223-224, 226,
230, 232, 236-237, 240, 244-245, 247, 251,
271-272, 276-277, 281-282, 286-287, 291-292,
294, 301-302, 339, 343-344, 350, 480-482,
485-487, 493, 496-497, 499-502, 509-510,
512-513, 517-519"
đây là 1 vài file bị lỗi

## 1. File danh sach chuong loi

Danh sach chuong loi da duoc luu tai:

```text
output/pham-tran-phi-tien/bad_chapters.txt
```

Moi dong la mot so chuong can crawl lai.

## 2. Reset progress truoc khi crawl lai

Crawler se bo qua chuong co trang thai `completed`, nen truoc khi crawl lai phai xoa cac chuong loi khoi `data/progress.json`.

Chay trong thu muc `truyendichAI`:

```powershell
node -e "const fs=require('fs');const list=fs.readFileSync('output/pham-tran-phi-tien/bad_chapters.txt','utf8').trim().split(/\s+/);const p='data/progress.json';const progress=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));for(const n of list) delete progress.chapters[n];fs.writeFileSync(p, JSON.stringify(progress,null,2)+'\n','utf8');console.log('reset chapters:', list.length);"
```

## 3. Crawl lai tung chuong

Chay trong thu muc `truyendichAI`:

```powershell
$env:DELAY_MIN_SECONDS='0'
$env:DELAY_MAX_SECONDS='0'
$list = Get-Content output\pham-tran-phi-tien\bad_chapters.txt
$failed = @()

foreach ($chapter in $list) {
  Write-Host "=== Re-crawl chapter $chapter ==="
  npm.cmd run dev -- crawl --url https://truyendich.live/doc-truyen/pham-tran-phi-tien --start $chapter --end $chapter --headful false
  if ($LASTEXITCODE -ne 0) { $failed += $chapter }
}

Write-Host "FAILED: $($failed -join ', ')"
```

Neu chay trong Codex ma gap loi:

```text
net::ERR_NETWORK_ACCESS_DENIED
```

thi do sandbox chan network. Can cho phep lenh crawler truy cap mang, hoac chay truc tiep trong terminal ngoai Codex.

## 4. Sau khi crawl lai

Kiem tra con chuong nao bi ky tu rac:

```powershell
node -e "const fs=require('fs');const path='output/pham-tran-phi-tien';const bad=[];for(const f of fs.readdirSync(path)){if(!/^\d+\.txt$/.test(f))continue;const s=fs.readFileSync(path+'/'+f,'utf8');let count=0;for(const ch of s){const c=ch.codePointAt(0);if((c>=0x13000&&c<=0x1342f)||c===0x995f)count++;}if(count>=3)bad.push(Number(f.slice(0,-4)));}bad.sort((a,b)=>a-b);console.log(bad.join(', '));console.log('TOTAL',bad.length);"
```

Neu `TOTAL 0` la sach.

## 5. Co che chan loi da them vao code

Da them detector trong:

```text
src/detectors/content-validator.ts
```

Crawler se reject noi dung co:

- Unicode Egyptian Hieroglyphs: `U+13000` den `U+1342F`
- Ky tu `饟`, mau rac dang lap lai trong cac file loi

Khi gap noi dung nay, crawler se bao loi:

```text
Noi dung rac/anti-bot glyphs
```

va dung chuong do ngay, khong ghi tiep noi dung rac moi.

## 6. Neu bi lai

Quy trinh ngan gon:

1. Quet chuong loi bang lenh o muc 4.
2. Cap nhat `output/pham-tran-phi-tien/bad_chapters.txt`.
3. Reset progress bang lenh o muc 2.
4. Crawl lai bang lenh o muc 3.
5. Quet lai den khi `TOTAL 0`.
