import { chromium } from "playwright";
import { load } from "cheerio";
import fs from "fs";
import path from "path";

const CURRENT_CHAPTER = 101;
const CURRENT_CHAPTER_URL =
  "https://truyennet.org/bach-luyen-thanh-tien/chuong-2463-q1Y1dG3FQ1Y4";
const END_CHAPTER = 2000;

const CHAPTERS_PER_FILE = 50;
const CONTENT_SELECTOR =
  ".truyen, #story, #chapter-reading-content, .chapter-content, .chapter-c";
const CONTENT_TIMEOUT_MS = 45000;
const MAX_PAGE_ATTEMPTS = 3;
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

const CRAWL_OUTPUT_ROOT = "Script/truyennet.org";
const getStorySlug = (chapterUrl) => {
  try {
    return new URL(chapterUrl).pathname.split("/").filter(Boolean)[0] || "truyen";
  } catch {
    return "truyen";
  }
};

const STORY_SLUG = getStorySlug(CURRENT_CHAPTER_URL);
const STORY_FOLDER = path.join(CRAWL_OUTPUT_ROOT, STORY_SLUG);
const STORY_URL = `https://truyennet.org/${STORY_SLUG}`;

const normalizeComparableUrl = (url) => url.replace(/[#?].*$/u, "").replace(/\/$/u, "");

const toAbsoluteUrl = (url) => new URL(url, "https://truyennet.org").toString();

const fetchHtmlWithPage = async (page, url) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
    try {
      const response = await page.request.get(url, {
        headers: {
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        timeout: 60000,
      });

      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()}`);
      }

      return response.text();
    } catch (err) {
      lastError = err;
      console.log(`Thu lai muc luc lan ${attempt}/${MAX_PAGE_ATTEMPTS}: ${err.message}`);
      await page.waitForTimeout(1000 * attempt);
    }
  }

  throw new Error(`Khong tai duoc ${url}: ${lastError.message}`);
};

const extractChapterLinks = (html, selector = "a[href]") => {
  const $ = load(html);

  return $(selector)
    .toArray()
    .map((element) => {
      const href = $(element).attr("href") || "";
      const text = $(element).text().trim();
      const url = toAbsoluteUrl(href);
      const pathParts = new URL(url).pathname.split("/").filter(Boolean);

      return {
        text,
        url,
        storySlug: pathParts[0] || "",
      };
    })
    .filter((link) => link.storySlug === STORY_SLUG)
    .filter((link) => /\/chuong-\d+/iu.test(new URL(link.url).pathname))
    .filter((link) => /chuong\s+\d+/iu.test(removeVietnameseMarks(link.text)));
};

const uniqueUrls = (links) => {
  const seen = new Set();
  const urls = [];

  for (const link of links) {
    const comparableUrl = normalizeComparableUrl(link.url);

    if (seen.has(comparableUrl)) {
      continue;
    }

    seen.add(comparableUrl);
    urls.push(link.url);
  }

  return urls;
};

const getStoryChapterUrls = async (page) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
    try {
      await page.goto(STORY_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForSelector("#chapter-list", {
        state: "attached",
        timeout: CONTENT_TIMEOUT_MS,
      });
      break;
    } catch (err) {
      lastError = err;
      console.log(`Thu lai trang muc luc lan ${attempt}/${MAX_PAGE_ATTEMPTS}: ${err.message}`);
      await page.waitForTimeout(1000 * attempt);
    }
  }

  if (lastError && !(await page.locator("#chapter-list").count())) {
    throw lastError;
  }

  const storyHtml = await page.content();
  const bookId =
    storyHtml.match(/onclick=['"]page\((\d+),\s*\d+\)/iu)?.[1] ||
    storyHtml.match(/name=['"]bid['"]\s+value=['"](\d+)['"]/iu)?.[1];
  const lastPage = Math.max(
    1,
    ...[...storyHtml.matchAll(/onclick=['"]page\(\d+,\s*(\d+)\)/giu)].map((match) =>
      Number(match[1])
    )
  );

  let links = extractChapterLinks(storyHtml, "#chapter-list a[href]");

  if (bookId) {
    for (let pageNumber = 2; pageNumber <= lastPage; pageNumber++) {
      const pageHtml = await fetchHtmlWithPage(
        page,
        `https://truyennet.org/get/listchap/${bookId}?page=${pageNumber}`
      );
      const data = JSON.parse(pageHtml).data || "";
      links = links.concat(extractChapterLinks(data));
    }
  }

  return uniqueUrls(links);
};

const getNextChapterCandidates = async (page, currentUrl) => {
  const currentComparableUrl = normalizeComparableUrl(currentUrl);
  const currentPathParts = new URL(currentUrl).pathname.split("/").filter(Boolean);
  const currentStorySlug = currentPathParts[0] || "";
  const currentChapterNumber =
    Number(currentPathParts[1]?.match(/chuong-(\d+)/iu)?.[1]) || 0;

  const candidates = await page.$$eval(
    "a[href]",
    (links, { currentComparableUrl, currentStorySlug, currentChapterNumber }) => {
      const normalizeText = (text) =>
        text
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\u0111/g, "d")
          .replace(/\u0110/g, "D")
          .toLowerCase();

      const normalizeUrl = (url) => url.replace(/[#?].*$/u, "").replace(/\/$/u, "");
      const getChapterNumber = (url) => {
        try {
          const chapterPart = new URL(url).pathname.split("/").filter(Boolean)[1] || "";
          return Number(chapterPart.match(/chuong-(\d+)/iu)?.[1]) || 0;
        } catch {
          return 0;
        }
      };

      return links
        .map((link) => {
          const href = link.getAttribute("href") || "";
          const url = new URL(href, window.location.href).toString();
          const pathParts = new URL(url).pathname.split("/").filter(Boolean);
          const comparableUrl = normalizeUrl(url);
          const text = normalizeText(link.textContent || "");
          const className = normalizeText(link.className || "");
          const rel = normalizeText(link.getAttribute("rel") || "");
          const title = normalizeText(link.getAttribute("title") || "");

          return {
            url,
            comparableUrl,
            storySlug: pathParts[0] || "",
            chapterNumber: getChapterNumber(url),
            text,
            className,
            rel,
            title,
          };
        })
        .filter((link) => {
          if (!link.url.includes("/chuong-")) return false;
          if (link.storySlug !== currentStorySlug) return false;
          if (link.comparableUrl === currentComparableUrl) return false;
          if (link.text.includes("chuong truoc")) return false;
          if (link.className.includes("prev")) return false;
          if (link.rel.includes("prev")) return false;
          if (link.title.includes("chuong truoc")) return false;
          if (
            currentChapterNumber > 0 &&
            link.chapterNumber > 0 &&
            link.chapterNumber <= currentChapterNumber
          ) {
            return false;
          }
          if (link.text.includes("trước")) return false;

          return true;
        })
        .map((link) => {
          let score = 100;
          const isExactNext =
            currentChapterNumber > 0 && link.chapterNumber === currentChapterNumber + 1;

          if (isExactNext) {
            score = 0;
          } else if (
            link.text.includes("chuong tiep") ||
            link.title.includes("chuong tiep") ||
            link.rel.includes("next")
          ) {
            score = 1;
          } else if (link.className.includes("next")) {
            score = 2;
          } else if (link.chapterNumber > currentChapterNumber) {
            score = 3 + link.chapterNumber - currentChapterNumber;
          }

          return {
            url: link.url,
            score,
            chapterNumber: link.chapterNumber,
          };
        })
        .sort((a, b) => a.score - b.score || a.chapterNumber - b.chapterNumber)
        .map((link) => link.url);
    },
    { currentComparableUrl, currentStorySlug, currentChapterNumber }
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

const stripSourceCredits = (text) =>
  text
    .replace(/Bạn đang đọc truyện được copy tại Truyện FULL\s*/giu, "")
    .replace(/Bạn đang đọc truyện được lấy tại Truyenyy chấm cơm\.?\s*/giu, "")
    .replace(/Nguồn truyện:\s*Truyện FULL\s*/giu, "")
    .replace(/Nguồn:\s*http:\/\/truyenfull\.\s*vn\s*/giu, "")
    .replace(/\s*-\s*www\.\s*Truyện FULL\s*/giu, "")
    .replace(
      /Truyện\s+(?:YY|Sắc Hiệp|Tiên Hiệp)\s*-\s*(?:http:\/\/truyenfull\.\s*vn|Truyện FULL)\s*/giu,
      ""
    )
    .replace(/\bDịch\s*(?:\+\s*Biên)?\s*:\s*[^\n.]{0,120}\.?\s*/giu, "")
    .replace(/\bBiên\s*:\s*[^\n.]{0,120}\.?\s*/giu, "")
    .replace(/\bNhóm\s+Dịch\s*:\s*[^\n.]{0,120}\.?\s*/giu, "")
    .replace(/\bNguồn\s*:\s*[^\n.]{0,120}\.?\s*/giu, "")
    .replace(
      /Do thay đổi nguồn dịch[^\n.!?]*(?:[.!?]\s*)?(?:Mong bạn đọc[^\n.!?]*(?:[.!?]\s*)?)?(?:Thân ái!?\s*)?/giu,
      ""
    )
    .replace(/\bbó\s+truyenfull\.\s*vn\s+rồi\b/giu, "bó tay rồi");

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
    "ban dang doc truyen duoc copy tai truyen full",
    "ban dang doc truyen duoc lay tai truyenyy cham com",
    "nguon truyen truyen full",
    "truyen yy http truyenfull vn",
    "www truyen full",
    "nguon http truyenfull vn",
    "truyen full",
    "truyenfull vn",
    "truyenyy",
    "nhom dich",
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
  let lines = splitLongLinesByPunctuation(stripSourceCredits(text))
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
  args: ["--disable-blink-features=AutomationControlled"],
});

const page = await browser.newPage({
  extraHTTPHeaders: {
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  locale: "vi-VN",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  viewport: {
    width: 1366,
    height: 768,
  },
});

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

const LOG_FILE = path.join(STORY_FOLDER, "crawl.log");
const originalConsoleLog = console.log.bind(console);

fs.writeFileSync(LOG_FILE, `Bat dau crawl ${new Date().toISOString()}\n`, "utf8");

console.log = (...args) => {
  const message = args.map((arg) => String(arg)).join(" ");
  originalConsoleLog(message);
  fs.appendFileSync(LOG_FILE, `${message}\n`, "utf8");
};

const chapterUrls = await getStoryChapterUrls(page);
console.log(`Da doc muc luc: ${chapterUrls.length} link chuong.`);

let currentUrl = chapterUrls[CURRENT_CHAPTER - 1] || CURRENT_CHAPTER_URL;
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
        chapterUrls[soChuong] ||
        nextCandidates.find(
          (candidateUrl) =>
            !visitedUrls.has(candidateUrl) &&
            normalizeComparableUrl(candidateUrl) !== normalizeComparableUrl(currentUrl)
        ) || "";

      const contentLocator = page.locator(CONTENT_SELECTOR).first();

      if ((await contentLocator.count()) === 0) {
        console.log(`Khong tim thay noi dung chuong ${soChuong}: ${currentUrl}`);
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
        console.log(
          `Chuong ${soChuong} khong co noi dung: raw=${rawContent.length}, clean=${content.length}, url=${currentUrl}`
        );
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

  if (finalText.trim()) {
    fs.writeFileSync(fileName, finalText.trim(), "utf8");
    console.log(`Da luu file ${fileName}`);
  } else {
    console.log(`Khong co noi dung trong nhom ${groupStart}-${groupEnd}, bo qua file ${fileName}`);
  }
}

await browser.close();

console.log("Xong toan bo.");
