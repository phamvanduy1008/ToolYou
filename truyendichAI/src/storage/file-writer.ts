import fs from "node:fs/promises";
import path from "node:path";
import { OUTPUT_DIR } from "../config/constants.js";
import type { ParsedChapter, StoryMetadata } from "../types/index.js";
import { safeSegment, chapterFileName } from "./filename.js";

export async function ensureProjectDirs(): Promise<void> {
  await Promise.all(["data", "output", "screenshots", "debug", "logs"].map((dir) => fs.mkdir(dir, { recursive: true })));
}

export async function writeMetadata(story: StoryMetadata): Promise<string> {
  const storyDir = path.join(OUTPUT_DIR, safeSegment(story.slug || story.title));
  await fs.mkdir(storyDir, { recursive: true });
  const filePath = path.join(storyDir, "metadata.json");
  await fs.writeFile(filePath, `${JSON.stringify(story, null, 2)}\n`, "utf8");
  return filePath;
}

export function formatStoryText(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/^\s*(D\u1ecbch AI|Dịch AI)\s*Convert\s*/i, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([.!?]+)(["'\u201d\u2019\u00bb)]*)\s*/g, "$1$2\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function writeChapterFile(story: StoryMetadata, chapter: ParsedChapter): Promise<string> {
  const storyDir = path.join(OUTPUT_DIR, safeSegment(story.slug || story.title));
  await fs.mkdir(storyDir, { recursive: true });
  const finalPath = path.join(storyDir, chapterFileName(chapter.number, chapter.title));
  const tempPath = `${finalPath}.tmp`;
  await fs.writeFile(tempPath, `${formatStoryText(chapter.content)}\n`, "utf8");
  await fs.rename(tempPath, finalPath);
  return finalPath;
}

export async function writeChapterBatchFile(story: StoryMetadata, chapters: ParsedChapter[]): Promise<string> {
  const sorted = [...chapters].sort((a, b) => a.number - b.number);
  if (sorted.length === 0) throw new Error("Cannot write an empty chapter batch");

  const storyDir = path.join(OUTPUT_DIR, safeSegment(story.slug || story.title));
  const mergeDir = path.join(storyDir, "merge");
  await fs.mkdir(mergeDir, { recursive: true });

  const start = sorted[0].number;
  const end = sorted[sorted.length - 1].number;
  const finalPath = path.join(mergeDir, `${start}-${end}.txt`);
  const tempPath = `${finalPath}.tmp`;
  const content = sorted.map((chapter) => formatStoryText(chapter.content)).join("\n\n");

  await fs.writeFile(tempPath, `${content}\n`, "utf8");
  await fs.rename(tempPath, finalPath);
  return finalPath;
}
