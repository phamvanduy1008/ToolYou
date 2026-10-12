import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const START = 1;
const END =  608;
const GROUP_SIZE = 50;
const REQUEST_DELAY_MS = 100;
const MAX_CHAPTER_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2_000;

const STORIES = [
  {
    title: "Ta Làm Anh Hùng Bàn Phím Tại Tu Tiên Giới",
    url: "https://truyenfull.live/ta-lam-anh-hung-ban-phim-tai-tu-tien-gioi/chuong-",
  },
  {
    title: "Trở Thành Tầm Bảo Trư, Ta Tu Tiên Dễ Như Chơi",
    url: "https://truyenfull.live/tro-thanh-tam-bao-tru-ta-tu-tien-de-nhu-choi/chuong-",
  },
  {
    title: "Tiểu Sư Muội Nhặt Rác Tu Tiên, Cả Tông Môn Xin Ôm Đùi",
    url: "https://truyenfull.live/tieu-su-muoi-nhat-rac-tu-tien-ca-tong-mon-xin-om-dui/chuong-",
  },
  {
    title: "Bắt Đầu Ban Thưởng 100 Triệu Mạng",
    url: "https://truyenfull.live/bat-dau-ban-thuong-100-trieu-mang/chuong-",
  },
];

const OUTPUT_ROOT = "D:/Code/TTS/cawl/TruyenFull/Tu Tiên";
const getStorySlug = (baseUrl) =>
  baseUrl.match(/\/([^/]+)\/chuong-$/)?.[1] ?? "truyen";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildChapterGroups = () => {
  const groups = [];
  for (let start = START; start <= END; start += GROUP_SIZE) {
    groups.push({ start, end: Math.min(start + GROUP_SIZE - 1, END) });
  }

  const lastGroup = groups.at(-1);
  const lastGroupSize = lastGroup ? lastGroup.end - lastGroup.start + 1 : 0;
  if (groups.length > 1 && lastGroupSize <= 20) {
    groups[groups.length - 2].end = lastGroup.end;
    groups.pop();
  }

  return groups;
};

const mapWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
};

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

export const crawlStory = async (story, storyIndex, totalStories) => {
  const storySlug = getStorySlug(story.url);
  const STORY_FOLDER = path.join(OUTPUT_ROOT, storySlug);
  fs.mkdirSync(STORY_FOLDER, { recursive: true });
  const statusFile = path.join(STORY_FOLDER, "_crawl-status.json");
  const completedChapters = [];
  const expectedCount = END - START + 1;
  const writeStatus = (status, extra = {}) => fs.writeFileSync(
    statusFile,
    `${JSON.stringify({
      status,
      story: story.title,
      range: { start: START, end: END, expectedCount },
      completedCount: completedChapters.length,
      completedChapters,
      missingChapters: Array.from(
        { length: expectedCount },
        (_, index) => START + index,
      ).filter((chapter) => !completedChapters.includes(chapter)),
      updatedAt: new Date().toISOString(),
      ...extra,
    }, null, 2)}\n`,
    "utf8",
  );

  console.log(`\n######## Truyện ${storyIndex}/${totalStories}: ${story.title} ########`);
  console.log(`Thư mục: ${STORY_FOLDER}`);
  writeStatus("running");

  try {
    for (const { start: groupStart, end: groupEnd } of buildChapterGroups()) {
    console.log(`\n===== Crawl chương ${groupStart}-${groupEnd} =====`);

    const chapterNumbers = Array.from(
      { length: groupEnd - groupStart + 1 },
      (_, index) => groupStart + index,
    );
    const results = await mapWithConcurrency(
      chapterNumbers,
      1,
      async (chapter) => {
        const url = `${story.url}${chapter}/`;
        let lastError;

        for (let attempt = 1; attempt <= MAX_CHAPTER_ATTEMPTS; attempt++) {
          console.log(
            `Đang crawl chương ${chapter} (lần ${attempt}/${MAX_CHAPTER_ATTEMPTS}): ${url}`,
          );

          try {
            const response = await client.get(url);
            const html = repairMojibake(response.data);
            const $ = cheerio.load(html);
            const chapterBox = $("#chapter-c").first();

            if (!chapterBox.length) {
              throw new Error("Không tìm thấy thẻ #chapter-c");
            }

            const content = cleanContent(stripChapterHeading(extractChapterText($, chapterBox)));
            if (content.length < 50) {
              throw new Error(`Nội dung quá ngắn (${content.length} ký tự)`);
            }

            console.log(`✓ Xong chương ${chapter}`);
            await sleep(REQUEST_DELAY_MS);
            return { chapter, content };
          } catch (error) {
            lastError = error;
            console.error(
              `✗ Lỗi chương ${chapter}, lần ${attempt}/${MAX_CHAPTER_ATTEMPTS}: ${error.message}`,
            );
            if (attempt < MAX_CHAPTER_ATTEMPTS) await sleep(RETRY_DELAY_MS);
          }
        }

        throw new Error(
          `DỪNG: không thể tải chương ${chapter} sau ${MAX_CHAPTER_ATTEMPTS} lần: ${lastError?.message}`,
        );
      },
    );

    if (results.length !== chapterNumbers.length) {
      throw new Error(
        `DỪNG: nhóm ${groupStart}-${groupEnd} chỉ có ${results.length}/${chapterNumbers.length} chương`,
      );
    }

    const fileName = path.join(STORY_FOLDER, `chuong-${groupStart}-${groupEnd}.txt`);
    fs.writeFileSync(fileName, `${results.map(({ content }) => content).join("\n\n\n")}\n`, "utf8");
    completedChapters.push(...results.map(({ chapter }) => chapter));
    writeStatus("running");
    console.log(`💾 Đã lưu ${fileName}`);
    }
  } catch (error) {
    writeStatus("failed", { error: error.message });
    console.error(`✗ Truyện chưa hoàn thành: ${story.title}`);
    console.error(error.message);
    throw error;
  }

  writeStatus("completed");
  console.log(`✓ Hoàn thành truyện: ${story.title}`);
};

export const crawl = async (stories = STORIES) => {
  for (let index = 0; index < stories.length; index++) {
    const story = stories[index];
    await crawlStory(story, index + 1, stories.length);
  }

  console.log(`\n🎉 Đã xử lý xong ${stories.length} truyện!`);
};

const isMainModule = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const requestedUrl = process.argv[2];
  const requestedTitle = process.argv[3];
  const stories = requestedUrl
    ? [{ title: requestedTitle || getStorySlug(requestedUrl), url: requestedUrl }]
    : STORIES;
  await crawl(stories);
}
