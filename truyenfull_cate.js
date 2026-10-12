import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const GROUP_SIZE = 10;
const MAX_CHAPTERS = 500;
const CATEGORY_PAGE_START = 1;
const CATEGORY_PAGE_END = 2; 
const CHAPTER_CONCURRENCY = 3;
const REQUEST_DELAY_MS = 800;
const PAGE_DELAY_MS = 1000;
const MAX_RETRIES = 6;
const OVERWRITE = false;
const REFERENCE_FILE_NAME = "_crawl-reference.json";

const CATEGORY_URL =
  "https://truyenfull.live/the-loai/truyen-ngan/";

// Mỗi danh mục sẽ được tạo thành một thư mục con trong thư mục gốc này.
// Ví dụ: D:/Code/TTS/cawl/TruyenFull/ngon-tinh-nguoc
const OUTPUT_ROOT_DIR = "D:/Code/TTS/cawl/TruyenFull";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cooldownUntil = 0;

const waitForCooldown = async () => {
  const remaining = cooldownUntil - Date.now();
  if (remaining > 0) await sleep(remaining);
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

const normalizePageUrl = (url) => `${url.replace(/\/+$/, "")}/`;

const getSlug = (url, fallback = "truyen") => {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return parts.at(-1) ?? fallback;
};

const sanitizeFolderName = (title, fallback) => {
  let name = repairMojibake(title ?? "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, "");

  if (!name) name = fallback;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) {
    name = `Truyện ${name}`;
  }
  return name;
};

const getStoryFolderName = (reference, storySlug, title) => {
  const existingFolder = reference.stories[storySlug]?.folder;
  if (existingFolder) return existingFolder;

  const candidate = sanitizeFolderName(title, storySlug);
  const usedFolders = new Set(
    Object.values(reference.stories)
      .map((story) => story?.folder?.toLocaleLowerCase("vi"))
      .filter(Boolean),
  );

  return usedFolders.has(candidate.toLocaleLowerCase("vi"))
    ? sanitizeFolderName(`${candidate} - ${storySlug}`, storySlug)
    : candidate;
};

const hasTextOutput = (folder) => {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return false;
  return fs.readdirSync(folder).some((name) => name.toLowerCase().endsWith(".txt"));
};

const loadReference = (fileName, categoryUrl) => {
  try {
    const data = JSON.parse(fs.readFileSync(fileName, "utf8"));
    return {
      categoryUrl,
      createdAt: data.createdAt ?? new Date().toISOString(),
      updatedAt: data.updatedAt,
      stories: data.stories && typeof data.stories === "object" ? data.stories : {},
    };
  } catch {
    return {
      categoryUrl,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      stories: {},
    };
  }
};

const saveReference = (fileName, reference) => {
  reference.updatedAt = new Date().toISOString();
  fs.writeFileSync(fileName, `${JSON.stringify(reference, null, 2)}\n`, "utf8");
};

export const resolveCategoryOutputRoot = (outputBaseDir, categoryUrl) => {
  if (fs.existsSync(outputBaseDir)) {
    for (const entry of fs.readdirSync(outputBaseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidateRoot = path.join(outputBaseDir, entry.name);
      const candidateReference = path.join(candidateRoot, REFERENCE_FILE_NAME);
      if (!fs.existsSync(candidateReference)) continue;

      try {
        const data = JSON.parse(fs.readFileSync(candidateReference, "utf8"));
        if (normalizePageUrl(data.categoryUrl) === categoryUrl) return candidateRoot;
      } catch {
        // Bỏ qua file tham chiếu hỏng và tiếp tục tìm thư mục khác.
      }
    }
  }

  return path.join(outputBaseDir, getSlug(categoryUrl, "danh-muc"));
};

const getPageUrl = (baseUrl, page) => page === 1
  ? normalizePageUrl(baseUrl)
  : new URL(`trang-${page}/`, normalizePageUrl(baseUrl)).href;

const getTotalPages = ($, baseUrl) => {
  const basePath = new URL(normalizePageUrl(baseUrl)).pathname;
  let total = 1;

  $(".pagination a[href]").each((_, element) => {
    try {
      const link = new URL($(element).attr("href"), baseUrl);
      if (!link.pathname.startsWith(basePath)) return;
      const page = Number(link.pathname.match(/\/trang-(\d+)\/?$/)?.[1]);
      if (Number.isInteger(page)) total = Math.max(total, page);
    } catch {
      // Bỏ qua link phân trang không hợp lệ.
    }
  });

  return total;
};

const fetchHtml = async (url) => {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await waitForCooldown();
      const response = await client.get(url);
      return cheerio.load(repairMojibake(response.data));
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      if (status === 403) {
        const accessError = new Error("HTTP 403 - website từ chối truy cập");
        accessError.status = 403;
        accessError.url = url;
        throw accessError;
      }
      const retryable = !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
      if (!retryable || attempt >= MAX_RETRIES) break;

      const retryAfter = Number(error.response?.headers?.["retry-after"]);
      const retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0;
      const exponentialMs = Math.min(30_000, 1_500 * (2 ** (attempt - 1)));
      const waitMs = Math.max(retryAfterMs, exponentialMs) + Math.floor(Math.random() * 1_000);
      cooldownUntil = Math.max(cooldownUntil, Date.now() + waitMs);
      console.log(
        `⚠ HTTP ${status ?? "network"} khi tải ${url}; ` +
        `thử lại sau ${(waitMs / 1000).toFixed(1)}s (${attempt}/${MAX_RETRIES})`,
      );
      await waitForCooldown();
    }
  }
  throw lastError;
};

export const getStoriesFromCategory = async (categoryUrl) => {
  const stories = new Map();
  const firstPage = await fetchHtml(getPageUrl(categoryUrl, 1));
  const totalPages = getTotalPages(firstPage, categoryUrl);
  const startPage = Math.max(1, Number(CATEGORY_PAGE_START) || 1);
  const configuredEndPage = CATEGORY_PAGE_END == null
    ? totalPages
    : Math.max(startPage, Number(CATEGORY_PAGE_END) || startPage);
  const endPage = Math.min(totalPages, configuredEndPage);

  if (startPage > totalPages) {
    console.log(`⚠ Danh mục chỉ có ${totalPages} trang; không có trang ${startPage}`);
    return [];
  }

  console.log(`📄 Chỉ lấy trang danh mục ${startPage}-${endPage}/${totalPages}`);

  for (let page = startPage; page <= endPage; page++) {
    const pageUrl = getPageUrl(categoryUrl, page);
    const $ = page === 1 ? firstPage : await fetchHtml(pageUrl);

    $("#list-page .col-truyen-main .truyen-title a[href]").each((_, element) => {
      const href = $(element).attr("href");
      if (!href) return;
      const url = normalizePageUrl(new URL(href, pageUrl).href);
      stories.set(url, {
        url,
        title: $(element).attr("title")?.trim() || $(element).text().trim() || getSlug(url),
      });
    });

    console.log(`✓ Danh mục ${page}/${totalPages}: đã lấy ${stories.size} truyện trong phạm vi`);
    if (page < endPage) await sleep(PAGE_DELAY_MS);
  }

  return [...stories.values()];
};

export const getChapterLinks = async (storyUrl, maxChapters = Number.POSITIVE_INFINITY) => {
  const chapters = new Map();
  const firstPage = await fetchHtml(getPageUrl(storyUrl, 1));
  const totalPages = getTotalPages(firstPage, storyUrl);
  let scannedPages = 0;

  for (let page = 1; page <= totalPages; page++) {
    const pageUrl = getPageUrl(storyUrl, page);
    const $ = page === 1 ? firstPage : await fetchHtml(pageUrl);

    $("#list-chapter .list-chapter a[href]").each((_, element) => {
      const href = $(element).attr("href");
      if (!href) return;
      const url = normalizePageUrl(new URL(href, pageUrl).href);
      chapters.set(url, {
        url,
        title: $(element).attr("title")?.trim() || $(element).text().trim(),
      });
    });

    scannedPages = page;
    if (totalPages > 1) {
      console.log(`  🔢 Danh sách chương ${page}/${totalPages}: đã thấy ${chapters.size} chương`);
    }

    if (chapters.size > maxChapters) break;
    if (page < totalPages) await sleep(PAGE_DELAY_MS);
  }

  const chapterLinks = [...chapters.values()];
  Object.defineProperties(chapterLinks, {
    scanStoppedEarly: { value: scannedPages < totalPages },
    totalChapterPages: { value: totalPages },
    scannedChapterPages: { value: scannedPages },
  });
  return chapterLinks;
};

const crawlStoryFromIndex = async (story, outputRoot, options = {}) => {
  const storyFolder = path.join(outputRoot, options.folderName ?? getSlug(story.url));
  const chapterLinks = await getChapterLinks(story.url, MAX_CHAPTERS);
  if (!chapterLinks.length) {
    console.log(`⚠ Không tìm thấy chương: ${story.title}`);
    return { status: "no_chapters", chapterCount: 0 };
  }

  if (chapterLinks.length > MAX_CHAPTERS) {
    const countText = chapterLinks.scanStoppedEarly
      ? `trên ${MAX_CHAPTERS}`
      : `${chapterLinks.length}`;
    console.log(`⏭ Bỏ qua ${story.title}: có ${countText} chương (giới hạn ${MAX_CHAPTERS})`);
    return {
      status: "skipped_too_many_chapters",
      chapterCount: chapterLinks.scanStoppedEarly ? null : chapterLinks.length,
      minimumChapterCount: chapterLinks.length,
    };
  }

  fs.mkdirSync(storyFolder, { recursive: true });

  console.log(`📚 ${story.title}: ${chapterLinks.length} chương`);
  let failedChapters = 0;

  for (let groupStart = 1; groupStart <= chapterLinks.length; groupStart += GROUP_SIZE) {
    const groupEnd = Math.min(groupStart + GROUP_SIZE - 1, chapterLinks.length);
    const fileName = path.join(storyFolder, `chuong-${groupStart}-${groupEnd}.txt`);

    if (!OVERWRITE && !options.overwriteExistingGroups && fs.existsSync(fileName)) {
      console.log(`↷ Đã có ${fileName}, bỏ qua`);
      continue;
    }

    const groupChapters = chapterLinks.slice(groupStart - 1, groupEnd);
    const results = await mapWithConcurrency(
      groupChapters,
      CHAPTER_CONCURRENCY,
      async (chapter, groupIndex) => {
        const index = groupStart - 1 + groupIndex;
        try {
          const $ = await fetchHtml(chapter.url);
          const chapterBox = $("#chapter-c").first();
          if (!chapterBox.length) throw new Error("không tìm thấy #chapter-c");

          const content = cleanContent(stripChapterHeading(extractChapterText($, chapterBox)));
          if (content.length < 50) throw new Error("nội dung quá ngắn");

          console.log(`  ✓ ${index + 1}/${chapterLinks.length}: ${chapter.title}`);
          return content;
        } catch (error) {
          failedChapters++;
          console.error(`  ✗ ${index + 1}/${chapterLinks.length}: ${chapter.url} - ${error.message}`);
          return null;
        } finally {
          await sleep(REQUEST_DELAY_MS);
        }
      },
    );
    const contents = results.filter(Boolean);

    if (contents.length === groupChapters.length) {
      fs.writeFileSync(fileName, `${contents.join("\n\n\n")}\n`, "utf8");
      console.log(`💾 Đã lưu ${fileName} (${contents.length}/${groupEnd - groupStart + 1} chương)`);
    } else {
      console.log(
        `⚠ Chưa lưu ${fileName}: thiếu ${groupChapters.length - contents.length} chương; ` +
        "lần chạy sau sẽ thử lại nhóm này",
      );
    }
  }

  const status = failedChapters ? "partial" : "completed";
  return {
    status,
    chapterCount: chapterLinks.length,
    failedChapters,
  };
};

// TruyenFull dùng URL chương tuần tự: <url-truyện>/chuong-<số>/.
// Đi thẳng vào URL chương giống truyenfull.js để không phải mở trang thông tin
// truyện, vì trang thông tin hiện có thể bị Cloudflare trả về 403.
export const crawlStory = async (story, outputRoot, options = {}) => {
  const storyFolder = path.join(outputRoot, options.folderName ?? getSlug(story.url));
  fs.mkdirSync(storyFolder, { recursive: true });

  let chapterCount = 0;
  let failedChapters = 0;
  let reachedStoryEnd = false;

  console.log(`📚 ${story.title}: tải trực tiếp URL từng chương`);

  for (let groupStart = 1; groupStart <= MAX_CHAPTERS; groupStart += GROUP_SIZE) {
    const groupEnd = Math.min(groupStart + GROUP_SIZE - 1, MAX_CHAPTERS);
    const fileName = path.join(storyFolder, `chuong-${groupStart}-${groupEnd}.txt`);
    let groupError;

    if (!OVERWRITE && !options.overwriteExistingGroups && fs.existsSync(fileName)) {
      console.log(`↷ Đã có ${fileName}, bỏ qua`);
      chapterCount = groupEnd;
      continue;
    }

    const chapters = [];
    for (let chapter = groupStart; chapter <= groupEnd; chapter++) {
      const url = new URL(`chuong-${chapter}/`, normalizePageUrl(story.url)).href;
      console.log(`  Đang crawl chương ${chapter}: ${url}`);

      try {
        const $ = await fetchHtml(url);
        const chapterBox = $("#chapter-c").first();

        if (!chapterBox.length) {
          reachedStoryEnd = true;
          console.log(`  ⏹ Không còn nội dung từ chương ${chapter}`);
          break;
        }

        const content = cleanContent(stripChapterHeading(extractChapterText($, chapterBox)));
        if (content.length < 50) {
          failedChapters++;
          console.log(`  ⚠ Chương ${chapter} có nội dung quá ngắn, không lưu`);
        } else {
          chapters.push(content);
          chapterCount = chapter;
          console.log(`  ✓ Xong chương ${chapter}`);
        }
      } catch (error) {
        if (error.response?.status === 404 || error.status === 404) {
          reachedStoryEnd = true;
          console.log(`  ⏹ Hết truyện tại chương ${chapter - 1}`);
          break;
        }

        // Không biết điểm cuối truyện khi request bị chặn/lỗi mạng; chuyển lỗi
        // lên vòng crawl truyện để bỏ qua truyện này thay vì quét tới chương 500.
        groupError = new Error(`lỗi chương ${chapter}: ${error.message}`, { cause: error });
        break;
      }

      await sleep(REQUEST_DELAY_MS);
    }

    if (chapters.length) {
      fs.writeFileSync(fileName, `${chapters.join("\n\n\n")}\n`, "utf8");
      console.log(`💾 Đã lưu ${fileName} (${chapters.length} chương)`);
    }

    if (groupError) throw groupError;
    if (reachedStoryEnd) break;
  }

  if (!chapterCount) {
    return { status: "no_chapters", chapterCount: 0 };
  }

  return {
    status: failedChapters ? "partial" : "completed",
    chapterCount,
    failedChapters,
  };
};

export const crawl = async (categoryUrl = CATEGORY_URL, outputBaseDir = OUTPUT_ROOT_DIR) => {
  const normalizedCategoryUrl = normalizePageUrl(categoryUrl);
  const outputRoot = resolveCategoryOutputRoot(outputBaseDir, normalizedCategoryUrl);
  fs.mkdirSync(outputRoot, { recursive: true });
  const referenceFile = path.join(outputRoot, REFERENCE_FILE_NAME);
  const reference = loadReference(referenceFile, normalizedCategoryUrl);

  console.log(`🔎 Đang lấy danh sách truyện từ ${normalizedCategoryUrl}`);
  const stories = await getStoriesFromCategory(normalizedCategoryUrl);
  console.log(`📖 Tìm thấy ${stories.length} truyện. Bắt đầu crawl lần lượt...`);
  saveReference(referenceFile, reference);

  for (let index = 0; index < stories.length; index++) {
    const story = stories[index];
    const storySlug = getSlug(story.url);
    const storyFolderName = getStoryFolderName(reference, storySlug, story.title);
    const storyFolder = path.join(outputRoot, storyFolderName);
    const previousStatus = reference.stories[storySlug]?.status;
    const terminalStatuses = new Set([
      "completed",
      "existing_output",
      "skipped_too_many_chapters",
      "no_chapters",
    ]);

    console.log(`\n===== Truyện ${index + 1}/${stories.length}: ${story.title} =====`);

    if (!OVERWRITE && terminalStatuses.has(previousStatus)) {
      console.log(`↷ Đã crawl ${story.title}, bỏ qua thư mục ${storyFolder}`);
      reference.stories[storySlug] = {
        ...reference.stories[storySlug],
        title: story.title,
        url: story.url,
        folder: storyFolderName,
        status: previousStatus || "existing_output",
        updatedAt: new Date().toISOString(),
      };
      saveReference(referenceFile, reference);
      continue;
    }

    reference.stories[storySlug] = {
      ...reference.stories[storySlug],
      title: story.title,
      url: story.url,
      folder: storyFolderName,
      status: "in_progress",
      updatedAt: new Date().toISOString(),
    };
    saveReference(referenceFile, reference);

    try {
      const result = await crawlStory(story, outputRoot, {
        folderName: storyFolderName,
        overwriteExistingGroups:
          ["partial", "in_progress", "error", "blocked_403"].includes(previousStatus) ||
          (!previousStatus && hasTextOutput(storyFolder)),
      });
      reference.stories[storySlug] = {
        title: story.title,
        url: story.url,
        folder: storyFolderName,
        ...result,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`✗ Bỏ qua truyện ${story.url}: ${error.message}`);
      reference.stories[storySlug] = {
        title: story.title,
        url: story.url,
        folder: storyFolderName,
        status: "error",
        error: error.message,
        updatedAt: new Date().toISOString(),
      };
    }
    saveReference(referenceFile, reference);
    await sleep(PAGE_DELAY_MS);
  }

  console.log(`🎉 Hoàn thành ${stories.length} truyện trong thư mục ${outputRoot}!`);
};

const isMainModule = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) await crawl(process.argv[2] ?? CATEGORY_URL, process.argv[3] ?? OUTPUT_ROOT_DIR);
