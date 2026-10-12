const fs = require("fs");
const path = require("path");
const config = require("../config");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function batchRange(index) {
  const batchSize = Math.max(1, Number(config.chaptersPerFile || 50));
  const start = Math.floor((Number(index) - 1) / batchSize) * batchSize + 1;
  const end = start + batchSize - 1;
  return { start, end };
}

function chapterFileName(index) {
  const { start, end } = batchRange(index);
  return `chuong-${String(start).padStart(3, "0")}-${String(end).padStart(3, "0")}.txt`;
}

function chapterFilePath(index) {
  return path.join(process.cwd(), config.outputDir, chapterFileName(index));
}

function chapterCacheDir() {
  return path.join(process.cwd(), config.outputDir, ".chapters");
}

function chapterCacheFileName(index) {
  return `chuong-${String(index).padStart(3, "0")}.txt`;
}

function chapterCacheFilePath(index) {
  return path.join(chapterCacheDir(), chapterCacheFileName(index));
}

function progressFilePath() {
  return path.join(process.cwd(), config.outputDir, ".progress.json");
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

function saveProgress(progress) {
  ensureDir(path.join(process.cwd(), config.outputDir));
  fs.writeFileSync(progressFilePath(), JSON.stringify(progress, null, 2), "utf8");
}

function hasSavedChapter(index) {
  const progress = loadProgress();
  return Boolean(progress.saved?.[String(index)]) && fs.existsSync(chapterCacheFilePath(index));
}

function countLines(text) {
  const value = String(text || "");
  if (!value) return 0;
  return value.split(/\r?\n/).length;
}

function rebuildBatchFile(index) {
  const { start, end } = batchRange(index);
  const parts = [];
  const lineRanges = {};
  let nextLine = 1;

  for (let chapterIndex = start; chapterIndex <= end; chapterIndex += 1) {
    const cachePath = chapterCacheFilePath(chapterIndex);
    if (!fs.existsSync(cachePath)) continue;

    const content = fs.readFileSync(cachePath, "utf8").trim();
    if (!content) continue;

    const lineCount = countLines(content);
    lineRanges[String(chapterIndex)] = {
      lineStart: nextLine,
      lineEnd: nextLine + lineCount - 1
    };

    parts.push(content);
    nextLine += lineCount + 2;
  }

  const filePath = chapterFilePath(index);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, parts.length ? `${parts.join("\n\n")}\n` : "", "utf8");

  const progress = loadProgress();
  progress.saved = progress.saved || {};

  for (let chapterIndex = start; chapterIndex <= end; chapterIndex += 1) {
    const saved = progress.saved[String(chapterIndex)];
    if (!saved) continue;

    if (lineRanges[String(chapterIndex)]) {
      saved.file = chapterFileName(chapterIndex);
      saved.lines = lineRanges[String(chapterIndex)];
    } else {
      delete saved.lines;
    }
  }

  saveProgress(progress);
  return filePath;
}

function rebuildAllBatchFiles() {
  const progress = loadProgress();
  const indexes = Object.keys(progress.saved || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const batchStarts = new Set(indexes.map((index) => batchRange(index).start));

  for (const start of batchStarts) {
    rebuildBatchFile(start);
  }
}

function saveChapter(index, content) {
  ensureDir(path.join(process.cwd(), config.outputDir));
  ensureDir(chapterCacheDir());

  const normalized = String(content || "").trim();
  fs.writeFileSync(chapterCacheFilePath(index), `${normalized}\n`, "utf8");

  const progress = loadProgress();
  progress.saved = progress.saved || {};
  progress.saved[String(index)] = {
    file: chapterFileName(index),
    cache: path.join(".chapters", chapterCacheFileName(index)).replace(/\\/g, "/"),
    savedAt: new Date().toISOString()
  };
  saveProgress(progress);

  return rebuildBatchFile(index);
}

module.exports = {
  ensureDir,
  batchRange,
  chapterFileName,
  chapterFilePath,
  chapterCacheDir,
  chapterCacheFileName,
  chapterCacheFilePath,
  progressFilePath,
  loadProgress,
  hasSavedChapter,
  rebuildBatchFile,
  rebuildAllBatchFiles,
  saveChapter
};
