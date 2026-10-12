import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const CURRENT_CHAPTER = 1;
const CURRENT_CHAPTER_URL =
  "https://metruyenchuvn.com/nhat-niem-than-ma/chuong-1-wwdeEHhib0dh";
const END_CHAPTER = 1;

const CHAPTERS_PER_FILE = 80;
const CONTENT_SELECTOR = ".truyen, #chapter-reading-content";
const CONTENT_TIMEOUT_MS = 45000;
const MAX_PAGE_ATTEMPTS = 2;
const BLOCKED_RESOURCE_TYPES = new Set([
  "image",
  "font",
  "media",
  "stylesheet",
]);
const BLOCKED_URL_PATTERNS = [
  "google-analytics",
  "googletagmanager",
  "doubleclick",
  "facebook",
  "analytics",
];

const CRAWL_OUTPUT_ROOT = "Script";
const STORY_SLUG =
  CURRENT_CHAPTER_URL.match(
    /(?:www\.)?metruyenchuvn\.com\/([^/]+)\/chuong-/
  )?.[1] ??
  "truyen";
const STORY_FOLDER = path.join(CRAWL_OUTPUT_ROOT, STORY_SLUG);

const normalizeComparableUrl = (url) => url.replace(/[#?].*$/u, "").replace(/\/$/u, "");

const getNextChapterCandidates = async (page, currentUrl) => {
  const currentComparableUrl = normalizeComparableUrl(currentUrl);

  const candidates = await page.$$eval(
    "a[href]",
    (links, currentComparableUrl) => {
      const normalizeText = (text) =>
        text
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\u0111/g, "d")
          .replace(/\u0110/g, "D")
          .toLowerCase();

      const normalizeUrl = (url) => url.replace(/[#?].*$/u, "").replace(/\/$/u, "");

      return links
        .map((link) => {
          const href = link.getAttribute("href") || "";
          const url = new URL(href, window.location.href).toString();
          const comparableUrl = normalizeUrl(url);
          const text = normalizeText(link.textContent || "");
          const className = normalizeText(link.className || "");

          return {
            url,
            comparableUrl,
            text,
            className,
          };
        })
        .filter((link) => {
          if (!link.url.includes("/chuong-")) return false;
          if (link.comparableUrl === currentComparableUrl) return false;
          if (link.text.includes("chuong truoc")) return false;
          if (link.className.includes("prev")) return false;
          if (link.text.includes("trước")) return false;

          return true;
        })
        .map((link) => {
          let score = 10;

          if (link.text.includes("chuong tiep")) {
            score = 0;
          } else if (link.className.includes("next")) {
            score = 1;
          } else if (!link.text.includes("chuong truoc")) {
            score = 2;
          }

          return {
            url: link.url,
            score,
          };
        })
        .sort((a, b) => a.score - b.score)
        .map((link) => link.url);
    },
    currentComparableUrl
  );

  return [...new Set(candidates)];
};

const openChapterPage = async (page, url) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await page.waitForSelector(CONTENT_SELECTOR, {
        state: "attached",
        timeout: CONTENT_TIMEOUT_MS,
      });

      return;
    } catch (err) {
      lastError = err;
      console.log(
        `Thu lai trang lan ${attempt}/${MAX_PAGE_ATTEMPTS}: ${err.message}`
      );
    }
  }

  throw lastError;
};

const stripChapterHeading = (text) => {
  const normalized = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const lines = normalized.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const headingLineRegex =
    /^(?:Ch\u01b0\u01a1ng|Chuong|Chapter)\s+\d+\s*(?:[:\uFF1A.-].*)?$/iu;
  const headingPrefixRegex =
    /^(?:Ch\u01b0\u01a1ng|Chuong|Chapter)\s+\d+\s*[:\uFF1A.-]?\s*[^\n"'\u201c\u201d]{0,120}(?=["'\u201c\u201d])/iu;

  if (lines.length > 1 && headingLineRegex.test(firstLine)) {
    return lines.slice(1).join("\n").trim();
  }

  return normalized.replace(headingPrefixRegex, "").trim();
};

const removeVietnameseMarks = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D");

const cleanInlineNoise = (text) =>
  text
    .replace(/(\p{L})[\u00b7\u2022\u2219\u2027](?=\p{L})/gu, "$1")
    .replace(/(\p{L})\s+[\u00b7\u2022\u2219\u2027]\s*(?=\p{L})/gu, "$1")
    .replace(/(\p{L})[\u200b-\u200d\ufeff](?=\p{L})/gu, "$1");

const normalizeObfuscatedLetters = (text) =>
  text
    .normalize("NFKC")
    .replace(/\u{1F17E}/gu, "O")
    .replace(/\u{1F183}/gu, "T");

const normalizeTextNoise = (text) =>
  cleanInlineNoise(normalizeObfuscatedLetters(text))
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu, " ")
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/([,.;:!?])(?=\p{L})/gu, "$1 ")
    .replace(/\.{4,}/g, "...")
    .replace(/([!?]){3,}/g, "$1$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const isWatermarkLine = (line) =>
  normalizeObfuscatedLetters(line)
    .replace(/[^\p{L}]/gu, "")
    .toLowerCase()
    .includes("vodtw");

const isJunkLine = (line, times) => {
  const normalized = normalizeTextNoise(line);
  const plain = removeVietnameseMarks(normalized).toLowerCase();

  if (isWatermarkLine(line)) return true;
  if (normalized.length > 15 && times >= 3) return true;
  if (/^\*+$/.test(normalized)) return true;

  return [
    "truyen duoc dang doc quyen",
    "hien tai co nhieu website sao chep",
    "xin cam on",
    "nguoi dang:",
    "giao dien cho dien thoai",
  ].some((pattern) => plain.includes(pattern));
};

const splitLongLinesByPunctuation = (text) =>
  text
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();

      if (trimmed.length <= 240) {
        return [trimmed];
      }

      return trimmed
        .replace(
          /([.!?\u2026\u3002\uFF01\uFF1F])\s+(?=["'\u201c\u201d]?\p{Lu})/gu,
          "$1\n"
        )
        .split("\n")
        .map((part) => part.trim())
        .filter(Boolean);
    })
    .join("\n");

const addPunctuation = (text) =>
  text
    .split("\n\n")
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return "";
      }

      const textBeforeClosingQuote = trimmed.replace(/["'\u201d]$/u, "");

      return /[.!?\u2026\u3002\uFF01\uFF1F]$/u.test(textBeforeClosingQuote)
        ? trimmed
        : `${trimmed}.`;
    })
    .join("\n\n")
    .trim();

const cleanContent = (text) => {
  let lines = splitLongLinesByPunctuation(text)
    .split("\n")
    .map((line) => normalizeTextNoise(line))
    .filter(Boolean);

  const countMap = new Map();

  for (const line of lines) {
    countMap.set(line, (countMap.get(line) || 0) + 1);
  }

  lines = lines.filter((line) => !isJunkLine(line, countMap.get(line)));

  return lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
};

const browser = await chromium.launch({
  headless: true,
});

const page = await browser.newPage();

await page.route("**/*", (route) => {
  const request = route.request();
  const resourceType = request.resourceType();
  const url = request.url().toLowerCase();

  if (
    BLOCKED_RESOURCE_TYPES.has(resourceType) ||
    BLOCKED_URL_PATTERNS.some((pattern) => url.includes(pattern))
  ) {
    return route.abort();
  }

  return route.continue();
});

fs.mkdirSync(STORY_FOLDER, { recursive: true });

let currentUrl = CURRENT_CHAPTER_URL;
const visitedUrls = new Set();

for (
  let groupStart = CURRENT_CHAPTER;
  groupStart <= END_CHAPTER;
  groupStart += CHAPTERS_PER_FILE
) {
  if (!currentUrl) {
    break;
  }

  const groupEnd = Math.min(groupStart + CHAPTERS_PER_FILE - 1, END_CHAPTER);

  let finalText = "";

  console.log(`\n===== Dang xu ly chuong ${groupStart}-${groupEnd} =====`);

  for (let soChuong = groupStart; soChuong <= groupEnd; soChuong++) {
    if (!currentUrl) {
      console.log("Khong con link chuong tiep theo, dung crawl.");
      break;
    }

    console.log(`Dang crawl chuong ${soChuong}: ${currentUrl}`);

    try {
      if (visitedUrls.has(currentUrl)) {
        console.log(`Link bi lap lai, dung crawl: ${currentUrl}`);
        currentUrl = "";
        break;
      }

      visitedUrls.add(currentUrl);

      await openChapterPage(page, currentUrl);

      const nextCandidates = await getNextChapterCandidates(page, currentUrl);
      const nextUrl =
        nextCandidates.find(
          (candidateUrl) =>
            !visitedUrls.has(candidateUrl) &&
            normalizeComparableUrl(candidateUrl) !== normalizeComparableUrl(currentUrl)
        ) || "";

      const contentLocator = page.locator(CONTENT_SELECTOR).first();

      if ((await contentLocator.count()) === 0) {
        console.log(`Khong tim thay noi dung chuong ${soChuong}`);
        currentUrl = nextUrl;
        continue;
      }

      const rawContent = await contentLocator.evaluate((el) => {
        const clone = el.cloneNode(true);

        clone
          .querySelectorAll("script, style, iframe, ins, .ads, .advert, i")
          .forEach((e) => e.remove());

        const paragraphs = [...clone.querySelectorAll("p")]
          .map((p) => p.innerText.trim())
          .filter(Boolean);

        if (paragraphs.length > 0) {
          return paragraphs.join("\n\n");
        }

        return clone.innerText;
      });

      let content = stripChapterHeading(rawContent);
      content = cleanContent(content);
      content = addPunctuation(content);

      if (!content || content.length < 50) {
        console.log(`Chuong ${soChuong} khong co noi dung`);
        currentUrl = nextUrl;
        continue;
      }

      finalText += `${content}\n\n`;

      console.log(`Da crawl xong chuong ${soChuong}`);
      currentUrl = nextUrl;

      if (!currentUrl && soChuong < groupEnd) {
        console.log("Da den chuong cuoi, khong thay nut chuong tiep.");
        break;
      }
    } catch (err) {
      console.log(`Loi chuong ${soChuong}: ${err.message}`);
      currentUrl = "";
      break;
    }
  }

  const fileName = path.join(
    STORY_FOLDER,
    `chuong-${groupStart}-${groupEnd}.txt`
  );

  fs.writeFileSync(fileName, finalText.trim(), "utf8");

  console.log(`Da luu file ${fileName}`);
}

await browser.close();

console.log("Xong toan bo.");
