const cheerio = require("cheerio");
const config = require("../config");
const { absoluteUrl } = require("./fetchPage");
const { decryptJson, decryptObjectValues, collectCandidateKeys } = require("./decrypt");

function getChapterFromPageProps(pageProps) {
  return pageProps?.chapter || pageProps?.data?.chapter || pageProps?.chap || {};
}

function getChapterTitle(chapter, index) {
  return chapter?.title || chapter?.name || chapter?.chapter_name || chapter?.chapter_title || `Chương ${index}`;
}

function numberFromAny(value) {
  const match = String(value || "").match(/(?:chuong|chapter)?[-_\s]*(\d{1,5})/i);
  return match ? Number(match[1]) : 0;
}

function normalizeEntry(entry, index) {
  if (typeof entry === "string") {
    return {
      index,
      title: `Chương ${index}`,
      slug: entry,
      url: buildChapterUrl(entry, index)
    };
  }

  const slug = entry.slug || entry.chapter_slug || entry.alias || entry.key || entry.url_slug || "";
  const rawUrl = entry.url || entry.href || entry.link || entry.path || "";
  const order =
    Number(entry.index || entry.order || entry.stt || entry.chapter_number || entry.number || entry.position) ||
    numberFromAny(slug || rawUrl || entry.name || entry.title) ||
    index;

  return {
    ...entry,
    index: order,
    title: getChapterTitle(entry, order),
    slug,
    url: rawUrl ? absoluteUrl(rawUrl) : buildChapterUrl(slug, order)
  };
}

function buildChapterUrl(slug, index) {
  if (slug && /^https?:\/\//i.test(slug)) return slug;
  if (slug && slug.startsWith("/")) return absoluteUrl(slug);
  if (slug && slug.includes("/")) return absoluteUrl(`/${slug}`);
  if (slug) return absoluteUrl(`/chapter/${slug}`);

  return config.chapterUrlPattern.replace("{n}", String(index));
}

function parseChapterListFromRs(rs, currentChapter, scripts = []) {
  const keys = collectCandidateKeys(currentChapter, scripts);
  let list = decryptJson(rs, keys);

  if (list && typeof list === "object" && !Array.isArray(list)) {
    const decrypted = decryptObjectValues(list, keys);
    return Object.entries(decrypted)
      .map(([order, slug], idx) => normalizeEntry({ slug, chapter_number: Number(order) + 1 }, idx + 1))
      .filter((entry) => entry.url)
      .sort((a, b) => a.index - b.index);
  }

  if (!list && Array.isArray(rs)) {
    list = rs.map((item) => decryptJson(item, keys) || item);
  }

  if (!Array.isArray(list)) return [];

  return list
    .map((entry, idx) => normalizeEntry(entry, idx + 1))
    .filter((entry) => entry.url)
    .sort((a, b) => a.index - b.index);
}

function buildFallbackChapterList(count) {
  return Array.from({ length: count }, (_, idx) => {
    const index = idx + 1;
    return {
      index,
      title: `Chương ${index}`,
      slug: "",
      url: config.chapterUrlPattern.replace("{n}", String(index))
    };
  });
}

function resolveChapterList(pageProps, scripts = [], options = {}) {
  const currentChapter = getChapterFromPageProps(pageProps);
  const rawList = currentChapter.rs || pageProps.rs || pageProps.chapters || pageProps.list_chapter || [];
  const parsed = parseChapterListFromRs(rawList, currentChapter, scripts);

  if (parsed.length) return parsed;

  const count = Number(currentChapter.count_chapter || pageProps.count_chapter || config.expectedChapterCount || 0);
  if (count > 0 && config.chapterUrlPattern) {
    console.warn("Không parse được rs, fallback sang CHAPTER_URL_PATTERN.");
    const fallback = buildFallbackChapterList(count);
    if (options.seedUrl && fallback[0]) {
      fallback[0].url = options.seedUrl;
    }
    return fallback;
  }

  return [];
}

function htmlToText(html) {
  const $ = cheerio.load(`<article>${html || ""}</article>`, { decodeEntities: true });

  $("script, style, iframe, noscript, button, svg").remove();
  $("br").replaceWith("\n");
  $("p, div, h1, h2, h3, h4, li, blockquote").each((_, el) => {
    const node = $(el);
    node.before("\n");
    node.after("\n");
  });

  return $("article")
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isLikelyReadableText(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (value.startsWith("U2FsdGVkX1")) return false;

  const chars = [...value];
  const nonSpace = chars.filter((char) => !/\s/u.test(char)).length || 1;
  const letters = (value.match(/\p{L}/gu) || []).length;
  const replacement = (value.match(/\uFFFD/g) || []).length;
  const controls = (value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length;
  const symbols = chars.filter((char) => /[^\p{L}\p{N}\s.,!?;:'"()\[\]{}\-–—…]/u.test(char)).length;

  if (replacement > 0) return false;
  if (controls > 0) return false;
  if (value.length < 120) return letters > 20;

  const letterRatio = letters / nonSpace;
  const symbolRatio = symbols / nonSpace;

  return letterRatio >= 0.35 && symbolRatio <= 0.08;
}

function stripChapterHeading(text) {
  return String(text || "")
    .replace(/^\s*chương\s*\d{1,5}\s*[:：\-–—.]?.*(?:\r?\n)+/iu, "")
    .replace(/^\s*chapter\s*\d{1,5}\s*[:：\-–—.]?.*(?:\r?\n)+/iu, "")
    .trim();
}

function formatChapterText(chapter, text, index) {
  const cleanText = stripChapterHeading(text);
  const title = getChapterTitle(chapter, index);
  const cleanTitle = String(title || "").trim();

  if (!cleanTitle || cleanTitle.startsWith("U2FsdGVkX1") || cleanText.startsWith(cleanTitle)) return `${cleanText}\n`;
  return `${cleanText}\n`;
}

module.exports = {
  getChapterFromPageProps,
  getChapterTitle,
  resolveChapterList,
  htmlToText,
  isLikelyReadableText,
  stripChapterHeading,
  formatChapterText
};
