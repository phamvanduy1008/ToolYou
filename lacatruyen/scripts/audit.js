const fs = require("fs");
const config = require("../config");
const { isLikelyReadableText } = require("../src/chapter");
const { batchRange, chapterFileName, chapterFilePath, chapterCacheFilePath, progressFilePath } = require("../src/save");

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

function loadProgress() {
  const filePath = progressFilePath();
  if (!fs.existsSync(filePath)) return { saved: {} };

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return { saved: {} };
  }
}

function groupConsecutive(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const groups = [];

  for (const number of sorted) {
    const last = groups[groups.length - 1];
    if (last && number === last.end + 1) {
      last.end = number;
    } else {
      groups.push({ start: number, end: number });
    }
  }

  return groups;
}

function batchKey(index) {
  const range = batchRange(index);
  return `${range.start}-${range.end}`;
}

function getTextStats(text) {
  const value = String(text || "");
  const chars = [...value];
  const nonSpace = chars.filter((char) => !/\s/u.test(char)).length || 1;
  const letters = (value.match(/\p{L}/gu) || []).length;
  const encryptedMarkers = (value.match(/U2FsdGVkX1/g) || []).length;
  const replacement = (value.match(/\uFFFD/g) || []).length;
  const controls = (value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length;
  const weirdSymbols = chars.filter((char) => /[^\p{L}\p{N}\s.,!?;:'"()\[\]{}\-–—…]/u.test(char)).length;

  return {
    chars: value.length,
    encryptedMarkers,
    replacement,
    controls,
    letterRatio: Number((letters / nonSpace).toFixed(3)),
    weirdSymbolRatio: Number((weirdSymbols / nonSpace).toFixed(3)),
    readable: isLikelyReadableText(value)
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const from = Number(args.start || args.from || config.startChapter || 1);
  const to = Number(args.to || config.expectedChapterCount);
  const progress = loadProgress();
  const missing = [];
  const badChapters = [];
  const badBatches = new Map();
  const missingBatches = new Map();
  const checkedLegacyBatchKeys = new Set();

  for (let index = from; index <= to; index += 1) {
    const saved = progress.saved?.[String(index)];
    const cachePath = chapterCacheFilePath(index);

    if (!saved || !fs.existsSync(cachePath)) {
      missing.push(index);
      missingBatches.set(batchKey(index), batchRange(index));
      continue;
    }

    const text = fs.readFileSync(cachePath, "utf8");
    const stats = getTextStats(text);
    if (!stats.readable || stats.encryptedMarkers || stats.replacement || stats.controls) {
      badChapters.push({ index, stats });
      badBatches.set(batchKey(index), {
        ...batchRange(index),
        file: chapterFileName(index),
        stats
      });
    }
  }

  for (let index = from; index <= to; index += 1) {
    const range = batchRange(index);
    const key = `${range.start}-${range.end}`;
    if (checkedLegacyBatchKeys.has(key) || badBatches.has(key)) continue;
    checkedLegacyBatchKeys.add(key);

    const filePath = chapterFilePath(index);
    if (!fs.existsSync(filePath)) continue;

    const text = fs.readFileSync(filePath, "utf8");
    const stats = getTextStats(text);
    if (!stats.readable || stats.encryptedMarkers || stats.replacement || stats.controls) {
      badBatches.set(key, {
        ...range,
        file: chapterFileName(index),
        stats
      });
    }
  }

  console.log(`Audit từ chương ${from} tới ${to}`);
  console.log(`Thiếu progress/file: ${missing.length} chương`);

  for (const group of groupConsecutive(missing)) {
    console.log(`- Thiếu chương ${group.start}${group.start === group.end ? "" : `-${group.end}`}`);
  }

  console.log(`Chương cache có dấu hiệu mã hóa/rác: ${badChapters.length}`);
  for (const chapter of badChapters) {
    console.log(
      `- Chương ${chapter.index}: chars=${chapter.stats.chars}, U2FsdGVkX1=${chapter.stats.encryptedMarkers}, ` +
        `replacement=${chapter.stats.replacement}, controls=${chapter.stats.controls}, ` +
        `letterRatio=${chapter.stats.letterRatio}, weirdSymbolRatio=${chapter.stats.weirdSymbolRatio}`
    );
  }

  console.log(`Batch có dấu hiệu mã hóa/rác: ${badBatches.size}`);
  for (const batch of badBatches.values()) {
    console.log(
      `- ${batch.file}: chars=${batch.stats.chars}, U2FsdGVkX1=${batch.stats.encryptedMarkers}, ` +
        `replacement=${batch.stats.replacement}, controls=${batch.stats.controls}, ` +
        `letterRatio=${batch.stats.letterRatio}, weirdSymbolRatio=${batch.stats.weirdSymbolRatio}`
    );
  }

  const rerunBatches = new Map([...missingBatches, ...badBatches].map(([key, value]) => [key, value]));
  if (!rerunBatches.size) {
    console.log("Không thấy batch lỗi hoặc chương thiếu.");
    return;
  }

  console.log("\nLệnh nên chạy lại:");
  for (const batch of [...rerunBatches.values()].sort((a, b) => a.start - b.start)) {
    const start = Math.max(batch.start, from);
    const end = Math.min(batch.end, to);
    console.log(`npm.cmd start -- --start ${start} --to ${end} --force true`);
  }
}

main();
