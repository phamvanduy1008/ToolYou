import fs from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { DATA_DIR, PROGRESS_PATH } from "../config/constants.js";
import type { ChapterLink, ChapterProgress, CrawlProgress, StoryMetadata } from "../types/index.js";

const emptyProgress: CrawlProgress = { chapters: {} };
const renameRetryCodes = new Set(["EACCES", "EBUSY", "EPERM"]);

export async function readProgress(): Promise<CrawlProgress> {
  try {
    const raw = await fs.readFile(PROGRESS_PATH, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, "")) as CrawlProgress;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...emptyProgress };
    throw error;
  }
}

export async function writeProgress(progress: CrawlProgress): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempPath = `${PROGRESS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(progress, null, 2)}\n`, "utf8");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rename(tempPath, PROGRESS_PATH);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !renameRetryCodes.has(code) || attempt === 7) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
      await sleep(100 * (attempt + 1));
    }
  }
}

export async function saveStoryProgress(story: StoryMetadata): Promise<CrawlProgress> {
  const progress = await readProgress();
  progress.story = story;
  await writeProgress(progress);
  return progress;
}

export async function upsertChapterProgress(chapter: ChapterProgress): Promise<CrawlProgress> {
  const progress = await readProgress();
  progress.chapters[String(chapter.number)] = chapter;
  if (chapter.status === "completed") {
    progress.lastRun = {
      ...(progress.lastRun ?? { startedAt: new Date().toISOString(), status: "running" }),
      lastCompletedChapter: chapter.number
    };
  }
  await writeProgress(progress);
  return progress;
}

export function isCompleted(progress: CrawlProgress, chapter: ChapterLink): boolean {
  const existing = progress.chapters[String(chapter.number)];
  return existing?.status === "completed" && existing.url === chapter.url;
}
