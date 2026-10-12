const path = require("path");
const config = require("./config");
const {
  sleep,
  absoluteUrl,
  fetchUrl,
  parseNextData,
  getPageProps,
  getScriptUrls,
  getLikelyChapterChunks,
  fetchBuildManifest,
  fetchScripts
} = require("./src/fetchPage");
const { collectCandidateKeys, decryptAes, decryptObjectValues, resolveRuntimeContentKey, resolveRuntimeContentKeys, resolveChapterContent } = require("./src/decrypt");
const {
  getChapterFromPageProps,
  resolveChapterList,
  htmlToText,
  isLikelyReadableText,
  formatChapterText
} = require("./src/chapter");
const { ensureDir, hasSavedChapter, saveChapter } = require("./src/save");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;

    const [rawKey, rawValue] = item.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[key] = rawValue ?? argv[i + 1];
    if (rawValue === undefined && argv[i + 1] && !argv[i + 1].startsWith("--")) i += 1;
  }
  return args;
}

async function loadNextPage(url) {
  const html = await fetchUrl(url);
  const nextData = parseNextData(html);
  return {
    html,
    nextData,
    pageProps: getPageProps(nextData)
  };
}

async function bootstrap(seedUrl, options = {}) {
  console.log(`Seed URL: ${seedUrl}`);
  const seed = await loadNextPage(seedUrl);
  const chunkUrls = options.skipScripts ? [] : getScriptUrls(seed.html);
  const buildManifest = options.skipScripts ? "" : await fetchBuildManifest(seed.nextData);
  const scripts = options.skipScripts ? [] : await fetchScripts(chunkUrls);

  if (buildManifest) {
    scripts.push({ url: "_buildManifest.js", source: buildManifest });
  }

  const seedChapter = getChapterFromPageProps(seed.pageProps);
  const keys = collectCandidateKeys(seedChapter, scripts);
  if (options.skipScripts) {
    console.log("Đang bật preview-only, bỏ qua tải JS chunk/decrypt key.");
  } else {
    console.log(`Tìm thấy ${chunkUrls.length} JS chunk, ${keys.length} key ứng viên.`);
  }

  const total = Number(seed.pageProps.count_chapter || seedChapter.count_chapter || config.expectedChapterCount);
  return { scripts, total };
}

function debugSeedData(pageProps, scripts) {
  const chapter = getChapterFromPageProps(pageProps);
  const keys = collectCandidateKeys(chapter, scripts);
  const preview = (value) => {
    if (value === undefined || value === null) return value;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 300 ? `${text.slice(0, 300)}...` : text;
  };

  console.log("pageProps keys:", Object.keys(pageProps));
  console.log("chapter keys:", Object.keys(chapter));
  console.log("candidate keys:", keys);
  console.log("count_chapter:", chapter.count_chapter || pageProps.count_chapter);
  console.log("slug/url:", chapter.slug || chapter.chapter_slug || chapter.url || chapter.href);
  console.log("rs type:", Array.isArray(chapter.rs) ? "array" : typeof chapter.rs);
  console.log("rs preview:", preview(chapter.rs));
  console.log("pageProps.rs type:", Array.isArray(pageProps.rs) ? "array" : typeof pageProps.rs);
  console.log("pageProps.rs preview:", preview(pageProps.rs));
  if (pageProps.rs && typeof pageProps.rs === "object") {
    const firstKey = Object.keys(pageProps.rs)[0];
    console.log("first rs key:", firstKey);
    for (const key of keys) {
      console.log(`first rs decrypt with ${key}:`, preview(decryptAes(pageProps.rs[firstKey], key)));
    }
  }
  console.log("ri preview:", preview(pageProps.ri));
  for (const key of keys) {
    console.log(`ri decrypt with ${key}:`, preview(decryptAes(pageProps.ri, key)));
  }
  const appDecryptedRs = decryptObjectValues(pageProps.rs || {}, keys);
  const riPlain = keys.map((key) => decryptAes(pageProps.ri, key)).find(Boolean);
  console.log("runtime ri:", riPlain);
  console.log("runtime rs value:", preview(appDecryptedRs?.[riPlain]));
  console.log("comment_count:", pageProps.comment_count);
  console.log("runtime content key:", preview(resolveRuntimeContentKey(pageProps, scripts)));
  for (const runtimeKey of resolveRuntimeContentKeys(pageProps, scripts).slice(0, 5)) {
    console.log("content with runtime key:", preview(decryptAes(chapter.content, runtimeKey)));
    console.log("content_comp with runtime key:", preview(decryptAes(chapter.content_comp, runtimeKey)));
  }
  console.log("content preview:", preview(chapter.content));
  console.log("content_comp preview:", preview(chapter.content_comp));
  console.log("key_encrypt preview:", preview(chapter.key_encrypt));
  console.log("chapterLeft preview:", preview(pageProps.chapterLeft));
  console.log("chapterRight preview:", preview(pageProps.chapterRight));
  console.log("story preview:", preview(pageProps.story));
  console.log("previewHtml:", preview(pageProps.previewHtml));

  const content = resolveChapterContent(pageProps, scripts);
  console.log("resolved content length:", content.html.length);
  console.log("resolved encrypted:", content.encrypted);
  console.log("resolved key:", content.key);

  for (const script of scripts) {
    const source = script.source || "";
    const terms = [
      "AES.decrypt",
      "decryptWithKey:function",
      "decryptObject:function",
      "decrypt:function",
      "decryptWithKey",
      "decryptObject",
      "commentCount:",
      "commentCount:l",
      "commentCount:c",
      "comment_count:c",
      "comment_count",
      ".PF=",
      "PF:function",
      "content_comp"
    ];
    console.log(`script: ${script.url || "inline"} length=${source.length}`);
    for (const term of terms) {
      const at = source.indexOf(term);
      if (at >= 0) {
        const start = Math.max(0, at - 500);
        const end = Math.min(source.length, at + 900);
        console.log(`--- snippet ${term} ---`);
        console.log(source.slice(start, end));
      }
    }

    const importMatch = source.match(/[,;]\s*I\s*=\s*n\((\d+)\)/);
    if (importMatch) {
      const moduleId = importMatch[1];
      console.log(`module for I: ${moduleId}`);
      const moduleAt = source.indexOf(`${moduleId}:`);
      if (moduleAt >= 0) {
        console.log(`--- module ${moduleId} ---`);
        console.log(source.slice(moduleAt, Math.min(source.length, moduleAt + 2200)));
      }
    }

    for (const moduleId of ["98530", "72262"]) {
      const moduleAt = source.indexOf(`${moduleId}:`);
      if (moduleAt >= 0) {
        console.log(`--- module ${moduleId} in ${script.url || "inline"} ---`);
        console.log(source.slice(moduleAt, Math.min(source.length, moduleAt + 3200)));
      }
    }
  }
}

function chapterUrlFromSlug(slug) {
  if (!slug) return "";
  if (/^https?:\/\//i.test(slug)) return slug;
  return absoluteUrl(`/chapter/${slug}`);
}

function boolArg(value, fallback = false) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === true;
}

async function crawlChapterUrl(url, scripts, total, options = {}) {
  const page = await loadNextPage(url);
  const chapter = getChapterFromPageProps(page.pageProps);
  const index = Number(chapter.chapter_order) || Number(options.fallbackIndex) || 0;
  const nextUrl = chapterUrlFromSlug(page.pageProps.chapterRight?.slug);

  console.log(`Đang tải chương ${index || "?"}/${total}: ${url}`);

  if (options.shouldSave === false) {
    return { index, nextUrl, page };
  }

  const previewText = page.pageProps.previewHtml ? htmlToText(page.pageProps.previewHtml) : "";
  const canUsePreview = previewText && isLikelyReadableText(previewText);
  const content = { html: "", encrypted: false };

  if ((options.previewOnly || options.preferPreview) && canUsePreview) {
    content.html = page.pageProps.previewHtml;
    console.log(`Dùng previewHtml của chương ${index}.`);
  } else if (options.previewOnly) {
    throw new Error(`previewHtml của chương ${index} không đọc được, bỏ qua decrypt vì đang bật --preview-only`);
  } else {
    Object.assign(content, resolveChapterContent(page.pageProps, scripts));
  }

  if (!content.html) {
    const extraScripts = await fetchScripts(getLikelyChapterChunks(page.html));
    const retryContent = resolveChapterContent(page.pageProps, [...scripts, ...extraScripts]);
    if (retryContent.html) {
      content.html = retryContent.html;
    } else if (canUsePreview) {
      content.html = page.pageProps.previewHtml;
      content.encrypted = false;
      console.warn(`Không giải mã được content AES của chương ${index}, dùng previewHtml sạch từ __NEXT_DATA__.`);
    } else {
      throw new Error(`Không giải mã được content/content_comp của chương ${index}`);
    }
  }

  let text = htmlToText(content.html);

  if (!isLikelyReadableText(text) && canUsePreview) {
      console.warn(`Nội dung decrypt của chương ${index} không đọc được, dùng previewHtml sạch.`);
      text = previewText;
      content.html = page.pageProps.previewHtml;
  }

  if (!text) {
    throw new Error(`Nội dung chương ${index} rỗng sau khi chuyển HTML -> text`);
  }
  if (!isLikelyReadableText(text)) {
    throw new Error(`Nội dung chương ${index} có vẻ là dữ liệu mã hóa/rác, không lưu vào txt`);
  }

  const finalText = formatChapterText(chapter, text, index);
  const filePath = saveChapter(index, finalText, { overwriteBatch: options.overwrite });
  console.log(`Đã lưu ${path.relative(process.cwd(), filePath)}`);

  return { index, nextUrl, page };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seedUrl = args.url || config.startUrl;
  const from = Number(args.start || args.startChapter || args.from || config.startChapter || 1);
  const to = Number(args.to || 0);
  const limit = Number(args.limit || 0);
  const overwrite = boolArg(args.force, config.overwrite);
  const previewOnly = boolArg(args.previewOnly, config.previewOnly);
  const preferPreview = boolArg(args.preferPreview, config.preferPreview);
  const continueOnError = boolArg(args.continueOnError, config.continueOnError);

  ensureDir(path.join(process.cwd(), config.outputDir));

  if (args.debugSeed === "1" || args.debugSeed === "true") {
    const seed = await loadNextPage(seedUrl);
    const scripts = await fetchScripts(getScriptUrls(seed.html));
    debugSeedData(seed.pageProps, scripts);
    return;
  }

  const { scripts, total } = await bootstrap(seedUrl, { skipScripts: previewOnly });
  const maxChapter = to || total;
  let currentUrl = seedUrl;
  let savedOrAttempted = 0;
  const seen = new Set();

  console.log(`Bắt đầu crawl tuần tự "${config.novelTitle}" - ${total} chương.`);

  while (currentUrl && !seen.has(currentUrl)) {
    seen.add(currentUrl);

    let result;
    let nextUrlAfterError = "";
    let indexAfterError = seen.size;
    try {
      const peek = await loadNextPage(currentUrl);
      const chapter = getChapterFromPageProps(peek.pageProps);
      const index = Number(chapter.chapter_order) || seen.size;
      const nextUrl = chapterUrlFromSlug(peek.pageProps.chapterRight?.slug);
      nextUrlAfterError = nextUrl;
      indexAfterError = index;

      if (index > maxChapter) break;

      if (index < from) {
        console.log(`Đi qua chương ${index}/${total} để tới --from ${from}.`);
        currentUrl = nextUrl;
        continue;
      }

      if (!overwrite && hasSavedChapter(index)) {
        console.log(`Bỏ qua chương ${index}/${total} vì file đã tồn tại.`);
        savedOrAttempted += 1;
        currentUrl = nextUrl;
      } else {
        result = await crawlChapterUrl(currentUrl, scripts, total, { fallbackIndex: index, overwrite, previewOnly, preferPreview });
        savedOrAttempted += 1;
        currentUrl = result.nextUrl;
      }
    } catch (error) {
      console.error(`Lỗi tại ${currentUrl}: ${error.message}`);
      if (!continueOnError || !nextUrlAfterError) {
        break;
      }

      console.warn(`Bỏ qua chương ${indexAfterError}/${total} và tiếp tục chương sau.`);
      savedOrAttempted += 1;
      currentUrl = nextUrlAfterError;
    }

    if (limit && savedOrAttempted >= limit) break;
    await sleep(config.delayMs);
  }

  console.log("Hoàn tất.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
