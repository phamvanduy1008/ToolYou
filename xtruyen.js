import { chromium } from "playwright";
import { load } from "cheerio";
import iconv from "iconv-lite";
import fs from "fs";
import path from "path";

const START_URL =
  "https://www.xtruyen.net/truyen/pham-tran-phi-tien/chuong-451/";

const MAX_CHAPTERS = 1000;
const GROUP_SIZE = 50;
const CONTENT_SELECTOR = "#chapter-reading-content";
const CONTENT_TIMEOUT_MS = 45000;
const MAX_PAGE_ATTEMPTS = 2;
const USE_FAST_REQUEST = false;

const HEADLESS = false;
const BLOCK_HEAVY_RESOURCES = false;
const ALLOW_MANUAL_UNBLOCK = true;
const MANUAL_UNBLOCK_TIMEOUT_MS = 300000;
const MIN_CHAPTER_DELAY_MS = 0;
const MAX_CHAPTER_DELAY_MS = 0;
const BATCH_PAUSE_EVERY = 0;
const MIN_BATCH_PAUSE_MS = 0;
const MAX_BATCH_PAUSE_MS = 0;
const XTRUYEN_ORIGIN = "https://www.xtruyen.net";
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
  "ads",
];

const getStorySlug = (chapterUrl) => {
  try {
    const parts = new URL(chapterUrl).pathname.split("/").filter(Boolean);
    const truyenIndex = parts.indexOf("truyen");

    return parts[truyenIndex + 1] || "truyen";
  } catch {
    return "truyen";
  }
};

const STORY_SLUG = getStorySlug(START_URL);
const STORY_FOLDER = STORY_SLUG;
const PROFILE_DIR = path.join(process.cwd(), ".xtruyen-profile");
const START_CHAPTER_NUMBER =
  Number(new URL(START_URL).pathname.match(/chuong-(\d+)/iu)?.[1]) || 1;

const normalizeComparableUrl = (url) =>
  url.replace(/[#?].*$/u, "").replace(/\/$/u, "");

const toAbsoluteUrl = (url) => new URL(url, XTRUYEN_ORIGIN).toString();

class IpBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "IpBlockedError";
  }
}

const randomBetween = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitPolitely = async (minMs, maxMs, reason) => {
  const delay = randomBetween(minMs, maxMs);

  if (delay <= 0) {
    return;
  }

  console.log(`${reason}: nghi ${(delay / 1000).toFixed(1)}s`);
  await sleep(delay);
};

const isIpBlockedText = (text) => {
  const plain = removeVietnameseMarks(text).toLowerCase();

  return [
    "truy cap bi tu choi",
    "thuc hien xac minh bao mat",
    "xac minh ban la con nguoi",
    "trang web nay su dung dich vu bao mat de chong bot",
    "tam khoa ip",
    "spam du lieu qua nhanh",
    "cloudflare",
    "access denied",
    "too many requests",
    "temporarily blocked",
  ].some((pattern) => plain.includes(pattern));
};

const waitForManualUnblock = async (page) => {
  if (!ALLOW_MANUAL_UNBLOCK) {
    return false;
  }

  console.log(
    `Trang dang bao khoa IP/Cloudflare. Giu cua so browser mo, hay doi/refresh neu can. Cho toi da ${MANUAL_UNBLOCK_TIMEOUT_MS / 1000}s.`
  );

  const deadline = Date.now() + MANUAL_UNBLOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(5000);

    const pageText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");

    if (!isIpBlockedText(pageText)) {
      console.log("Da het trang khoa IP, tiep tuc crawl.");
      return true;
    }
  }

  return false;
};

const hasMojibake = (text) =>
  /(?:á[º»]|Ä[‘’…]|Æ[°¡]|Ã[\u0080-\u00bf]|Â[\u0080-\u00bf])/u.test(text);

const repairMojibake = (text) => {
  if (!hasMojibake(text)) {
    return text;
  }

  return iconv.decode(iconv.encode(text, "win1252"), "utf8");
};

const getChapterInfoFromUrl = (url) => {
  const chapter =
    Number(new URL(url).pathname.match(/chuong-(\d+)/iu)?.[1]) || "?";

  return {
    chuong: chapter,
  };
};

const normalizeText = (text) =>
  text
    .replace(/\r/g, "")
    .replace(/(\p{L})[\u00b7\u2022\u2219\u2027](?=\p{L})/gu, "$1")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu, " ")
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,.!?;:])(?=\p{L})/gu, "$1 ")
    .replace(/([.!?])(["\u201d]?)(?=\p{Lu})/gu, "$1$2\n\n")
    .replace(/(Ch(?:u|uong|\u01b0\u01a1ng)\s+\d+)\s*:\s*:\s*/giu, "$1: ")
    .replace(/(Ch(?:u|uong|\u01b0\u01a1ng)\s+\d+:[^\n.]+)\.\1/giu, "$1.")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const removeVietnameseMarks = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D");

const isJunkLine = (line, times) => {
  const plain = removeVietnameseMarks(line).toLowerCase();

  if (line.length > 15 && times >= 3) return true;
  if (/^\*+$/.test(line)) return true;

  return [
    "truyen duoc dang doc quyen",
    "hien tai co nhieu website sao chep",
    "xin cam on",
    "nguoi dang:",
    "giao dien cho dien thoai",
    "ban dang doc truyen",
    "click de xem",
    "xtruyen",
  ].some((pattern) => plain.includes(pattern));
};

const stripChapterHeading = (text) => {
  const normalized = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const lines = normalized.split("\n");
  const firstLine = lines[0]?.trim() ?? "";

  if (/^(?:Chuong|Ch\u01b0\u01a1ng|Chapter)\s+\d+\b/iu.test(firstLine)) {
    return lines.slice(1).join("\n").trim();
  }

  return normalized;
};

const cleanContent = (text) => {
  let lines = normalizeText(stripChapterHeading(text))
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const countMap = new Map();

  for (const line of lines) {
    countMap.set(line, (countMap.get(line) || 0) + 1);
  }

  lines = lines.filter((line) => !isJunkLine(line, countMap.get(line)));

  return lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
};

const fetchHtmlWithRequest = async (context, url) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
    try {
      const response = await context.request.get(url, {
        headers: {
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        timeout: 60000,
      });

      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()}`);
      }

      const html = (await response.body()).toString("utf8");

      if (isIpBlockedText(html)) {
        throw new IpBlockedError("Xtruyen dang khoa IP vi request qua nhanh.");
      }

      return html;
    } catch (err) {
      if (err instanceof IpBlockedError) {
        throw err;
      }

      lastError = err;
      console.log(`Thu lai request lan ${attempt}/${MAX_PAGE_ATTEMPTS}: ${err.message}`);
      await sleep(3000 * attempt);
    }
  }

  throw new Error(`Khong tai duoc ${url}: ${lastError.message}`);
};

const extractContentFromHtml = (html) => {
  const $ = load(html);
  const content = $(CONTENT_SELECTOR).first();

  if (!content.length) {
    return "";
  }

  content.find("script, style, iframe, ins, .ads, .advert, i, a").remove();

  const paragraphs = content
    .find("p")
    .toArray()
    .map((element) => $(element).text().trim())
    .filter(Boolean);

  return repairMojibake(
    paragraphs.length > 0 ? paragraphs.join("\n\n") : content.text()
  );
};

const extractNextUrlFromHtml = (html, currentUrl) => {
  const $ = load(html);
  const currentComparableUrl = normalizeComparableUrl(currentUrl);
  const currentChapter = getChapterInfoFromUrl(currentUrl).chuong;
  const selectors = [
    ".nav-next a.next_page",
    "a.next_page",
    "a[rel='next']",
    ".next a",
    "a[href*='chuong-']",
  ];
  const candidates = [];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const href = $(element).attr("href");

      if (!href) return;

      const url = toAbsoluteUrl(href);
      const comparableUrl = normalizeComparableUrl(url);
      const text = removeVietnameseMarks($(element).text()).toLowerCase();
      const className = removeVietnameseMarks($(element).attr("class") || "").toLowerCase();
      const title = removeVietnameseMarks($(element).attr("title") || "").toLowerCase();
      const chapter = getChapterInfoFromUrl(url).chuong;

      if (!url.includes(`/truyen/${STORY_SLUG}/chuong-`)) return;
      if (comparableUrl === currentComparableUrl) return;
      if (text.includes("truoc") || className.includes("prev") || title.includes("truoc")) {
        return;
      }
      if (Number.isFinite(currentChapter) && Number.isFinite(chapter) && chapter <= currentChapter) {
        return;
      }

      let score = 100;

      if (Number.isFinite(currentChapter) && chapter === currentChapter + 1) {
        score = 0;
      } else if (text.includes("tiep") || title.includes("tiep")) {
        score = 1;
      } else if (className.includes("next")) {
        score = 2;
      } else if (Number.isFinite(currentChapter) && Number.isFinite(chapter)) {
        score = 3 + chapter - currentChapter;
      }

      candidates.push({ url, score, chapter: Number.isFinite(chapter) ? chapter : 0 });
    });
  }

  candidates.sort((a, b) => a.score - b.score || a.chapter - b.chapter);

  return candidates[0]?.url || "";
};

const openChapterPage = async (page, url) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      const pageText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");

      if (isIpBlockedText(pageText)) {
        const unblocked = await waitForManualUnblock(page);

        if (unblocked) {
          continue;
        }

        throw new IpBlockedError("Xtruyen dang chan boi IP/Cloudflare.");
      }

      await page.waitForSelector(CONTENT_SELECTOR, {
        state: "attached",
        timeout: CONTENT_TIMEOUT_MS,
      });

      await page.waitForFunction(
        (selector) => {
          const element = document.querySelector(selector);
          return element && element.innerText.trim().length > 200;
        },
        CONTENT_SELECTOR,
        { timeout: CONTENT_TIMEOUT_MS }
      );

      return;
    } catch (err) {
      if (err instanceof IpBlockedError) {
        throw err;
      }

      lastError = err;
      console.log(`Thu lai browser lan ${attempt}/${MAX_PAGE_ATTEMPTS}: ${err.message}`);
      await sleep(3000 * attempt);
    }
  }

  throw lastError;
};

const getChapterWithFallback = async (context, page, url) => {
  if (USE_FAST_REQUEST) {
    try {
      const html = await fetchHtmlWithRequest(context, url);
      const rawContent = extractContentFromHtml(html);
      const nextUrl = extractNextUrlFromHtml(html, url);

      if (rawContent.trim().length > 200) {
        return { rawContent, nextUrl };
      }
    } catch (err) {
      if (err instanceof IpBlockedError) {
        throw err;
      }

      console.log(`Request khong dung duoc, fallback browser: ${err.message}`);
    }
  }

  await openChapterPage(page, url);

  const rawContent = await page.locator(CONTENT_SELECTOR).first().evaluate((el) => {
    const clone = el.cloneNode(true);

    clone
      .querySelectorAll("script, style, iframe, ins, .ads, .advert, i, a")
      .forEach((e) => e.remove());

    const paragraphs = [...clone.querySelectorAll("p")]
      .map((p) => p.innerText.trim())
      .filter(Boolean);

    return paragraphs.length > 0 ? paragraphs.join("\n\n") : clone.innerText;
  });
  const html = await page.content();

  return {
    rawContent: repairMojibake(rawContent),
    nextUrl: extractNextUrlFromHtml(html, url),
  };
};

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: HEADLESS,
  args: [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--no-first-run",
  ],
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

await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", {
    get: () => undefined,
  });
});

const page = await context.newPage();

if (BLOCK_HEAVY_RESOURCES) {
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
}

fs.mkdirSync(STORY_FOLDER, { recursive: true });

const LOG_FILE = path.join(STORY_FOLDER, "crawl.log");
const originalConsoleLog = console.log.bind(console);

fs.writeFileSync(LOG_FILE, `Bat dau crawl ${new Date().toISOString()}\n`, "utf8");

console.log = (...args) => {
  const message = args.map((arg) => String(arg)).join(" ");
  originalConsoleLog(message);
  fs.appendFileSync(LOG_FILE, `${message}\n`, "utf8");
};

let currentUrl = START_URL;
let crawledCount = 0;
let groupStart = START_CHAPTER_NUMBER;
let lastSavedChapter = START_CHAPTER_NUMBER - 1;
let finalText = "";
const visited = new Set();

while (currentUrl && crawledCount < MAX_CHAPTERS) {
  const comparableUrl = normalizeComparableUrl(currentUrl);

  if (visited.has(comparableUrl)) {
    console.log(`Link bi lap, dung: ${currentUrl}`);
    break;
  }

  visited.add(comparableUrl);

  const info = getChapterInfoFromUrl(currentUrl);
  console.log(`\nDang crawl chuong ${info.chuong}: ${currentUrl}`);

  try {
    const { rawContent, nextUrl } = await getChapterWithFallback(
      context,
      page,
      currentUrl
    );
    const content = cleanContent(rawContent);

    if (!content || content.length < 50) {
      console.log(
        `Chuong khong co noi dung hoac qua ngan: raw=${rawContent.length}, clean=${content.length}`
      );
      currentUrl = nextUrl;
      continue;
    }

    crawledCount++;
    lastSavedChapter = info.chuong;
    finalText += `${content}\n\n`;

    console.log(`Da crawl xong chuong ${lastSavedChapter} (${crawledCount}/${MAX_CHAPTERS})`);

    if (crawledCount % GROUP_SIZE === 0) {
      const groupEnd = lastSavedChapter;
      const fileName = path.join(
        STORY_FOLDER,
        `chuong-${groupStart}-${groupEnd}.txt`
      );

      fs.writeFileSync(fileName, finalText.trim(), "utf8");
      console.log(`Da luu file: ${fileName}`);

      finalText = "";
      groupStart = lastSavedChapter + 1;
    }

    currentUrl = nextUrl;

    if (currentUrl && crawledCount < MAX_CHAPTERS) {
      if (BATCH_PAUSE_EVERY > 0 && crawledCount % BATCH_PAUSE_EVERY === 0) {
        await waitPolitely(
          MIN_BATCH_PAUSE_MS,
          MAX_BATCH_PAUSE_MS,
          `Da crawl ${crawledCount} chuong`
        );
      } else {
        await waitPolitely(
          MIN_CHAPTER_DELAY_MS,
          MAX_CHAPTER_DELAY_MS,
          "Gian cach chuong"
        );
      }
    }
  } catch (err) {
    if (err instanceof IpBlockedError) {
      console.log(err.message);
      console.log("Dung crawl de tranh bi khoa IP/Cloudflare lau hon. Hay doi mot luc roi chay tiep.");
      break;
    }

    console.log(`Loi tai ${currentUrl}: ${err.message}`);
    break;
  }
}

if (finalText.trim()) {
  const fileName = path.join(
    STORY_FOLDER,
    `chuong-${groupStart}-${lastSavedChapter}.txt`
  );

  fs.writeFileSync(fileName, finalText.trim(), "utf8");
  console.log(`Da luu file cuoi: ${fileName}`);
}

await context.close();

console.log("Xong toan bo.");
