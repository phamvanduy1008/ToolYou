const axios = require("axios");
const cheerio = require("cheerio");
const { decode } = require("html-entities");
const fs = require("fs");
const path = require("path");
const config = require("./config");

const ROOT_DIR = __dirname;
const PROGRESS_FILE = path.join(ROOT_DIR, "progress.json");
const DEBUG_DIR = path.join(ROOT_DIR, "debug");
const STORY_OUTPUT_DIR = path.join(
  ROOT_DIR,
  config.outputFolder,
  config.storySlug
);
const ALL_CHAPTERS_FILE = path.join(STORY_OUTPUT_DIR, "all_chapters.txt");
const BASE_ORIGIN = new URL(config.startUrl).origin;
const maxChapters =
  process.env.MAX_CHAPTERS !== undefined
    ? Number(process.env.MAX_CHAPTERS)
    : Number(config.maxChapters);
const startUrlOverride = process.env.START_URL || "";
const startIndexOverride =
  process.env.START_INDEX !== undefined ? Number(process.env.START_INDEX) : 0;
const ignoreProgress = process.env.IGNORE_PROGRESS === "1";

let browserClosing = false;
let currentProgress = null;

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function ensureDirs() {
  fs.mkdirSync(STORY_OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  const min = Number(config.delayMin) || 3000;
  const max = Math.max(Number(config.delayMax) || 6000, min);
  return Math.floor(min + Math.random() * (max - min + 1));
}

function padIndex(index) {
  return String(index).padStart(4, "0");
}

function stripVietnameseMarks(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function sanitizeFilePart(text) {
  return stripVietnameseMarks(text)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function cleanText(text) {
  return decode(String(text || ""))
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeDuplicateTitle(content, title) {
  if (!content || !title) return content;

  const lines = content.split("\n");
  const normalizedTitle = title.trim().toLowerCase();

  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }

  if (lines[0] && lines[0].trim().toLowerCase() === normalizedTitle) {
    lines.shift();
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractInitialDataJson(html) {
  const marker = "window.__INITIAL_DATA__";
  const markerIndex = html.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error("Khong tim thay window.__INITIAL_DATA__");
  }

  const equalsIndex = html.indexOf("=", markerIndex);
  const startIndex = html.indexOf("{", equalsIndex);

  if (equalsIndex === -1 || startIndex === -1) {
    throw new Error("Khong tim thay JSON sau window.__INITIAL_DATA__");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < html.length; i++) {
    const char = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return html.slice(startIndex, i + 1);
      }
    }
  }

  throw new Error("JSON window.__INITIAL_DATA__ khong dong ngoac dung");
}

function replaceBareJsValues(jsText) {
  let result = "";
  let inString = false;
  let escaped = false;
  const replacements = [
    ["undefined", "null"],
    ["-Infinity", "null"],
    ["Infinity", "null"],
    ["NaN", "null"],
  ];

  for (let i = 0; i < jsText.length; i++) {
    const char = jsText[i];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    let replaced = false;
    for (const [from, to] of replacements) {
      if (
        jsText.startsWith(from, i) &&
        !/[\w$]/.test(jsText[i - 1] || "") &&
        !/[\w$]/.test(jsText[i + from.length] || "")
      ) {
        result += to;
        i += from.length - 1;
        replaced = true;
        break;
      }
    }

    if (replaced) {
      continue;
    }

    result += char;
  }

  return result;
}

function parseInitialData(html) {
  const jsonText = extractInitialDataJson(html);
  return JSON.parse(replaceBareJsValues(jsonText));
}

function findChapterPayload(value, seen = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (
    value.chapterInfo &&
    typeof value.chapterInfo === "object" &&
    value.chapterInfo.Description
  ) {
    return value;
  }

  for (const child of Object.values(value)) {
    const found = findChapterPayload(child, seen);
    if (found) return found;
  }

  return null;
}

function detectBlockedPage(html, data) {
  const text = cheerio.load(html)("body").text().toLowerCase();
  const hardSignals = ["captcha", "cloudflare"];

  const found = hardSignals.find((signal) => text.includes(signal));
  if (found) return `Phat hien trang chan hoac yeu cau xac thuc: ${found}`;

  if (!data || !data.chapterInfo) {
    return "Khong co chapterInfo trong initial data";
  }

  if (data.chapterInfo.IsVip && data.chapterInfo.MemberCanReadFull === false) {
    return "Chuong VIP bi khoa: MemberCanReadFull=false";
  }

  const rawContent = data.chapterInfo.Description || "";
  const softSignals = ["dang nhap", "đăng nhập", "login", "paywall", "tra phi", "trả phí"];
  const softFound = softSignals.find((signal) => text.includes(signal));
  if (softFound && cleanText(rawContent).length < config.minContentLength) {
    return `Phat hien trang yeu cau xac thuc hoac tra phi: ${softFound}`;
  }

  return null;
}

function buildChapterUrl(chapterId) {
  return `${BASE_ORIGIN}/doc-truyen/${config.storySlug}/read/${chapterId}.html`;
}

function getNextUrl(data, currentUrl, completedUrls) {
  const next = data.nextChapterInfo;
  if (!next || !next._id) return null;

  const nextUrl = buildChapterUrl(next._id);
  if (nextUrl === currentUrl) return null;
  if (completedUrls.has(nextUrl)) return null;

  return nextUrl;
}

function defaultProgress() {
  return {
    lastUrl: "",
    nextUrl: startUrlOverride || config.startUrl,
    chapterIndex: startIndexOverride || 1,
    completedUrls: [],
    failedUrls: [],
    updatedAt: nowIso(),
  };
}

function loadProgress() {
  if (ignoreProgress) {
    return defaultProgress();
  }

  if (!fs.existsSync(PROGRESS_FILE)) {
    return defaultProgress();
  }

  const parsed = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  return {
    ...defaultProgress(),
    ...parsed,
    completedUrls: Array.isArray(parsed.completedUrls)
      ? parsed.completedUrls
      : [],
    failedUrls: Array.isArray(parsed.failedUrls) ? parsed.failedUrls : [],
  };
}

function saveProgress(progress) {
  progress.updatedAt = nowIso();
  currentProgress = progress;
  fs.writeFileSync(PROGRESS_FILE, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
}

function writeDebug(index, url, html, error, data) {
  const prefix = path.join(DEBUG_DIR, padIndex(index));
  fs.writeFileSync(`${prefix}-page.html`, html || "", "utf8");

  const bodyText = html ? cheerio.load(html)("body").text() : "";
  fs.writeFileSync(`${prefix}-body.txt`, cleanText(bodyText), "utf8");

  fs.writeFileSync(
    `${prefix}-error.json`,
    `${JSON.stringify(
      {
        url,
        message: error && error.message ? error.message : String(error),
        title: data && data.chapterInfo ? data.chapterInfo.ContentTitle : "",
        updatedAt: nowIso(),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    timeout: 60000,
    responseType: "text",
    maxRedirects: 3,
    headers: {
      "User-Agent": userAgent,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });

  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.data;
}

async function fetchChapterWithRetry(url, chapterIndex, progress) {
  let lastError = null;
  let lastHtml = "";
  let lastData = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[RETRY] Thu lai lan ${attempt}`);
      }

      const html = await fetchHtml(url);
      lastHtml = html;

      const data = parseInitialData(html);
      const payload = findChapterPayload(data);
      lastData = payload || data;

      const blockedReason = detectBlockedPage(html, payload);
      if (blockedReason) {
        throw new Error(blockedReason);
      }

      const chapter = payload.chapterInfo;
      const title = cleanText(chapter.ContentTitle || chapter.SeoTitle || "");
      let content = cleanText(chapter.Description || "");
      content = removeDuplicateTitle(content, title);

      if (!content || content.length < config.minContentLength) {
        throw new Error(`Noi dung qua ngan: ${content.length} ky tu`);
      }

      return { payload, title, content };
    } catch (error) {
      lastError = error;
      console.log(`[ERROR] ${error.message}`);

      if (attempt < config.maxRetries) {
        await sleep(1000 * attempt * attempt);
      }
    }
  }

  writeDebug(chapterIndex, url, lastHtml, lastError, lastData);
  progress.failedUrls.push({
    url,
    reason: lastError ? lastError.message : "Unknown error",
    failedAt: nowIso(),
  });
  saveProgress(progress);
  throw lastError || new Error("Khong crawl duoc chuong");
}

function chapterFilePath(index, title) {
  const safeTitle = sanitizeFilePart(title) || `Chuong ${index}`;
  return path.join(STORY_OUTPUT_DIR, `${padIndex(index)} - ${safeTitle}.txt`);
}

function saveChapter(index, title, content) {
  const filePath = chapterFilePath(index, title);
  const fileContent = `${title}\n\n${content}\n`;

  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.size > config.minContentLength) {
      console.log(`[SAVED] File da ton tai, bo qua ghi de: ${filePath}`);
    } else {
      fs.writeFileSync(filePath, fileContent, "utf8");
      console.log(`[SAVED] Da ghi lai file ngan: ${filePath}`);
    }
  } else {
    fs.writeFileSync(filePath, fileContent, "utf8");
    console.log(`[SAVED] ${filePath}`);
  }

  const separator = "\n\n============================================================\n\n";
  fs.appendFileSync(ALL_CHAPTERS_FILE, `${fileContent}${separator}`, "utf8");
}

function resetAllChaptersIfFresh(progress) {
  if (
    progress.chapterIndex === 1 &&
    progress.completedUrls.length === 0 &&
    fs.existsSync(ALL_CHAPTERS_FILE)
  ) {
    fs.writeFileSync(ALL_CHAPTERS_FILE, "", "utf8");
  }
}

function handleExitSignal(signal) {
  if (browserClosing) return;
  browserClosing = true;

  console.log(`\n[STOP] Nhan ${signal}, dang luu progress va thoat an toan`);
  if (currentProgress) {
    saveProgress(currentProgress);
  }
  process.exit(0);
}

async function main() {
  ensureDirs();
  process.on("SIGINT", () => handleExitSignal("SIGINT"));
  process.on("SIGTERM", () => handleExitSignal("SIGTERM"));

  const progress = loadProgress();
  saveProgress(progress);
  resetAllChaptersIfFresh(progress);

  const completedUrls = new Set(progress.completedUrls);
  const visitedUrls = new Set(progress.completedUrls);
  let currentUrl = progress.nextUrl || config.startUrl;
  let chapterIndex = Number(progress.chapterIndex) || 1;
  let crawledThisRun = 0;

  console.log("[START] Bat dau crawler");
  console.log(`[LOAD] Bat dau tu: ${currentUrl}`);

  while (currentUrl) {
    if (maxChapters > 0 && crawledThisRun >= maxChapters) {
      console.log(`[STOP] Dat gioi han maxChapters=${maxChapters}`);
      break;
    }

    if (visitedUrls.has(currentUrl) && !completedUrls.has(currentUrl)) {
      console.log("[STOP] Phat hien vong lap URL.");
      break;
    }

    if (completedUrls.has(currentUrl)) {
      console.log(`[SKIP] URL da hoan thanh: ${currentUrl}`);
      currentUrl = progress.nextUrl;
      if (!currentUrl || completedUrls.has(currentUrl)) break;
      continue;
    }

    visitedUrls.add(currentUrl);
    console.log(`[LOAD] Dang tai chuong ${chapterIndex}: ${currentUrl}`);

    const { payload, title, content } = await fetchChapterWithRetry(
      currentUrl,
      chapterIndex,
      progress
    );

    console.log(`[TITLE] ${title}`);
    console.log(`[CONTENT] ${content.length} ky tu`);

    saveChapter(chapterIndex, title, content);
    crawledThisRun++;

    completedUrls.add(currentUrl);
    const nextUrl = getNextUrl(payload, currentUrl, completedUrls);

    progress.lastUrl = currentUrl;
    progress.nextUrl = nextUrl || "";
    progress.chapterIndex = chapterIndex + 1;
    progress.completedUrls = Array.from(completedUrls);
    saveProgress(progress);

    if (!nextUrl) {
      console.log("[STOP] Khong con chuong tiep theo");
      break;
    }

    console.log(`[NEXT] ${nextUrl}`);
    const waitMs = randomDelay();
    console.log(`[WAIT] Cho ${(waitMs / 1000).toFixed(1)} giay`);
    await sleep(waitMs);

    currentUrl = nextUrl;
    chapterIndex++;
  }

  console.log("[DONE] Hoan tat");
}

main().catch((error) => {
  console.error(`[ERROR] ${error.stack || error.message}`);
  process.exit(1);
});
