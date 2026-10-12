import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const START = 1;
const END =  608;
const GROUP_SIZE = 50;
const REQUEST_DELAY_MS = 500;

const BASE_URL =
  "https://truyenfull.live/nu-phu-tu-tien-ta-luyen-dan-chi-de-nuoi-con/chuong-";

const STORY_SLUG = BASE_URL.match(/\/([^/]+)\/chuong-$/)?.[1] ?? "truyen";
const STORY_FOLDER = path.join(
  "D:/Code/TTS/cawl/TruyenFull/Tu Tiên",
  STORY_SLUG,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WINDOWS_1252_BYTES = new Map([
  ["€", 0x80], ["‚", 0x82], ["ƒ", 0x83], ["„", 0x84],
  ["…", 0x85], ["†", 0x86], ["‡", 0x87], ["ˆ", 0x88],
  ["‰", 0x89], ["Š", 0x8a], ["‹", 0x8b], ["Œ", 0x8c],
  ["Ž", 0x8e], ["‘", 0x91], ["’", 0x92], ["“", 0x93],
  ["”", 0x94], ["•", 0x95], ["–", 0x96], ["—", 0x97],
  ["˜", 0x98], ["™", 0x99], ["š", 0x9a], ["›", 0x9b],
  ["œ", 0x9c], ["ž", 0x9e], ["Ÿ", 0x9f],
]);

const MOJIBAKE_MARKERS = /(?:Ã|Â|Ä|Å|Æ|áº|á»|â€|ï¼|ðŸ|�)/g;
const mojibakeScore = (text) => (text.match(MOJIBAKE_MARKERS) ?? []).length;

const decodeWindows1252AsUtf8 = (text) => {
  const bytes = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (WINDOWS_1252_BYTES.has(character)) {
      bytes.push(WINDOWS_1252_BYTES.get(character));
    } else if (codePoint <= 0xff) {
      bytes.push(codePoint);
    } else {
      return null;
    }
  }
  return Buffer.from(bytes).toString("utf8");
};

export const repairMojibake = (text) => {
  let result = text;
  for (let attempt = 0; attempt < 2; attempt++) {
    const decoded = decodeWindows1252AsUtf8(result);
    if (!decoded || decoded.includes("�") || mojibakeScore(decoded) >= mojibakeScore(result)) break;
    result = decoded;
  }
  return result;
};

const stripChapterHeading = (text) => {
  const lines = text.replace(/\r/g, "").split("\n");
  const headingIndex = lines.findIndex((line, index) =>
    index < 3 && /^(?:Chương|Chuong|Chapter)\s+\d+(?:\s*[:：.\-–—].*)?$/iu.test(line.trim())
  );
  if (headingIndex !== -1) lines.splice(headingIndex, 1);
  return lines.join("\n").trim();
};

const isTrashLine = (line) => {
  const normalized = line.toLocaleLowerCase("vi");
  const trashPatterns = [
    /truyện được đăng độc quyền/u,
    /xin cảm ơn/u,
    /người đăng/u,
    /giao diện cho điện thoại/u,
    /(?:đọc|tải)\s+(?:truyện|app)/u,
    /bấm để xem/u,
    /nguồn truyện/u,
    /truyen\s*full/u,
    /truyenfull(?:vn|live)?/u,
    /(?:^|\s)quảng cáo(?:\s|$)/u,
    /^[“”‘’"'(\[]*lưu ý\s*\d*\s*:/u,
  ];
  return trashPatterns.some((pattern) => pattern.test(normalized));
};

const normalizeLine = (line) => line
  .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
  .replace(/\u00a0/g, " ")
  .replace(/[ \t]+/g, " ")
  .replace(/\s+([,.;:!?…])/g, "$1")
  .replace(/([,:;])(?=\p{L})/gu, "$1 ")
  .replace(/([“‘(])\s+/g, "$1")
  .replace(/\s+([”’)]|$)/g, "$1")
  // Bỏ kiểu che từ như "d.a.o", "t.ử" để máy không đọc chữ "chấm".
  .replace(/([\p{L}])\.(?=[\p{L}])/gu, "$1")
  .trim();

const splitStuckSentences = (line) => line
  .replace(/([.!?…][”’"']?)(?=[“‘"'(\p{Lu}])/gu, "$1\n")
  // Có trang làm mất cả dấu chấm: "dịu dàngTrước mặt".
  .replace(/([\p{Ll}][”’"']?)(?=\p{Lu})/gu, "$1.\n")
  .split("\n")
  .map((part) => part.trim())
  .filter(Boolean);

const hasTerminalPunctuation = (line) => /[.!?…][”’"')\]]?$/.test(line);

export const cleanContent = (text) => {
  const rawLines = repairMojibake(text)
    .replace(/\r/g, "")
    .split(/\n+/)
    .map(normalizeLine)
    .filter(Boolean)
    .flatMap(splitStuckSentences);

  const countMap = new Map();
  for (const line of rawLines) {
    const key = line.toLocaleLowerCase("vi");
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }

  const cleanedLines = rawLines.filter((line) => {
    const key = line.toLocaleLowerCase("vi");
    if (isTrashLine(line) || /^[*=_\-–—•·]{3,}$/.test(line)) return false;
    if (line.length > 15 && countMap.get(key) >= 3) return false;
    return true;
  });

  return cleanedLines
    .map((line) => hasTerminalPunctuation(line) ? line : `${line}.`)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const extractChapterText = ($, chapterBox) => {
  const box = chapterBox.clone();
  box.find(
    "script, style, noscript, iframe, .ads-responsive, .adsbygoogle, " +
    "#ads-chapter-top, #ads-chapter-bottom, [class*='advert'], [id*='advert']"
  ).remove();

  // Thêm xuống dòng trước .text(), tránh câu ở các thẻ kế nhau bị dính.
  box.find("br").replaceWith("\n");
  box.find("p, div, blockquote, li, h1, h2, h3").each((_, element) => {
    $(element).prepend("\n").append("\n");
  });
  return box.text();
};

const client = axios.create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
  },
  timeout: 30_000,
  responseType: "text",
  responseEncoding: "utf8",
});

export const crawl = async () => {
  fs.mkdirSync(STORY_FOLDER, { recursive: true });

  for (let groupStart = START; groupStart <= END; groupStart += GROUP_SIZE) {
    const groupEnd = Math.min(groupStart + GROUP_SIZE - 1, END);
    const chapters = [];
    console.log(`\n===== Crawl chương ${groupStart}-${groupEnd} =====`);

    for (let chapter = groupStart; chapter <= groupEnd; chapter++) {
      const url = `${BASE_URL}${chapter}/`;
      console.log(`Đang crawl chương ${chapter}: ${url}`);

      try {
        const response = await client.get(url);
        const html = repairMojibake(response.data);
        const $ = cheerio.load(html);
        const chapterBox = $("#chapter-c").first();

        if (!chapterBox.length) {
          console.log(`⚠ Không tìm thấy nội dung chương ${chapter}`);
          continue;
        }

        const content = cleanContent(stripChapterHeading(extractChapterText($, chapterBox)));
        if (content.length < 50) {
          console.log(`⚠ Chương ${chapter} có nội dung quá ngắn, không lưu`);
          continue;
        }

        chapters.push(content);
        console.log(`✓ Xong chương ${chapter}`);
        await sleep(REQUEST_DELAY_MS);
      } catch (error) {
        console.error(`✗ Lỗi chương ${chapter}: ${error.message}`);
      }
    }

    if (!chapters.length) {
      console.log(`⚠ Không có chương hợp lệ trong nhóm ${groupStart}-${groupEnd}`);
      continue;
    }

    const fileName = path.join(STORY_FOLDER, `chuong-${groupStart}-${groupEnd}.txt`);
    fs.writeFileSync(fileName, `${chapters.join("\n\n\n")}\n`, "utf8");
    console.log(`💾 Đã lưu ${fileName}`);
  }

  console.log("🎉 Hoàn thành toàn bộ!");
};

const isMainModule = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) await crawl();
