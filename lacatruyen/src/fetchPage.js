const axios = require("axios");
const cheerio = require("cheerio");
const http = require("http");
const https = require("https");
const path = require("path");
const config = require("../config");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function absoluteUrl(url, baseUrl = config.baseUrl) {
  if (!url) return "";
  return new URL(url, baseUrl).toString();
}

function createClient() {
  const headers = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-encoding": "gzip, deflate, br",
    "accept-language": "vi,en-US;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    "connection": "close",
    "pragma": "no-cache",
    "referer": config.baseUrl,
    "sec-ch-ua": '"Google Chrome";v="126", "Chromium";v="126", "Not.A/Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
  };

  if (config.cookie) {
    headers.cookie = config.cookie;
  }

  return axios.create({
    timeout: config.requestTimeoutMs,
    responseType: "text",
    transformResponse: [(data) => data],
    headers,
    httpAgent: new http.Agent({ keepAlive: false }),
    httpsAgent: new https.Agent({ keepAlive: false }),
    maxRedirects: 5,
    validateStatus: () => true
  });
}

const client = createClient();

async function fetchUrl(url, options = {}) {
  const retries = options.retries ?? config.retries;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await client.get(url, {
        headers: options.headers || {}
      });

      if (response.status >= 200 && response.status < 300) {
        return response.data;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;

      const waitMs = retryDelayMs(error, attempt);
      console.warn(`Request lỗi (${attempt}/${retries}) ${url}: ${formatRequestError(error)}. Đợi ${waitMs}ms...`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

function retryDelayMs(error, attempt) {
  const networkErrors = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EAI_AGAIN", "ENOTFOUND"]);
  const isNetworkError = networkErrors.has(error.code) || networkErrors.has(error.cause?.code);
  const base = config.retryBaseDelayMs * attempt;
  const multiplier = isNetworkError ? 2 : 1;
  const jitter = Math.floor(Math.random() * 750);
  return base * multiplier + jitter;
}

function formatRequestError(error) {
  const parts = [
    error.code,
    error.response?.status ? `HTTP ${error.response.status}` : "",
    error.message,
    error.cause?.code,
    error.cause?.message
  ].filter(Boolean);

  if (Array.isArray(error.errors)) {
    for (const item of error.errors.slice(0, 3)) {
      parts.push([item.code, item.message].filter(Boolean).join(": "));
    }
  }

  return parts.length ? parts.join(" | ") : "unknown error";
}

function parseNextData(html) {
  const $ = cheerio.load(html);
  const raw = $("script#__NEXT_DATA__").first().text();
  if (!raw) {
    throw new Error("Không tìm thấy script#__NEXT_DATA__ trong HTML");
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Không parse được __NEXT_DATA__: ${error.message}`);
  }
}

function getPageProps(nextData) {
  return nextData?.props?.pageProps || {};
}

function getBuildId(nextData) {
  return nextData?.buildId || "";
}

function getScriptUrls(html) {
  const $ = cheerio.load(html);
  const urls = new Set();

  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src && src.includes("/_next/") && src.endsWith(".js")) {
      urls.add(absoluteUrl(src));
    }
  });

  return [...urls];
}

function getLikelyChapterChunks(html) {
  const scripts = getScriptUrls(html);
  const chapterChunks = scripts.filter((url) => {
    const normalized = decodeURIComponent(url);
    return normalized.includes("/chunks/pages/chapter/") || normalized.includes("/chunks/pages/chapter%2F");
  });

  return chapterChunks.length ? chapterChunks : scripts;
}

async function fetchBuildManifest(nextData) {
  const buildId = getBuildId(nextData);
  if (!buildId) return "";

  const manifestUrl = absoluteUrl(path.posix.join("/_next/static", buildId, "_buildManifest.js"));
  try {
    return await fetchUrl(manifestUrl);
  } catch (error) {
    console.warn(`Không tải được _buildManifest.js: ${error.message}`);
    return "";
  }
}

async function fetchScripts(urls) {
  const scripts = [];
  for (const url of urls) {
    try {
      const source = await fetchUrl(url);
      scripts.push({ url, source });
    } catch (error) {
      console.warn(`Không tải được JS chunk ${url}: ${error.message}`);
    }
  }

  return scripts;
}

module.exports = {
  sleep,
  absoluteUrl,
  fetchUrl,
  formatRequestError,
  parseNextData,
  getPageProps,
  getBuildId,
  getScriptUrls,
  getLikelyChapterChunks,
  fetchBuildManifest,
  fetchScripts
};
