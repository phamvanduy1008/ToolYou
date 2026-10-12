import fs from "node:fs/promises";
import { Command } from "commander";
import { createBrowserHandle } from "../browser/browser-manager.js";
import { clearStorageState, saveStorageState } from "../browser/session-manager.js";
import { crawlChapter } from "../crawler/chapter-crawler.js";
import { selectChapterRange } from "../crawler/chapter-queue.js";
import { RateLimiter } from "../crawler/rate-limiter.js";
import { crawlStory } from "../crawler/story-crawler.js";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { writeScreenshot } from "../storage/debug-writer.js";
import { ensureProjectDirs, writeChapterBatchFile } from "../storage/file-writer.js";
import { isCompleted, readProgress, upsertChapterProgress } from "../storage/progress-store.js";
import type { ChapterLink, CrawlProgress, ParsedChapter, StoryMetadata } from "../types/index.js";
import { assertTruyendichUrl } from "../utils/url.js";
import { sleep } from "../utils/delay.js";

interface CrawlOptions {
  url: string;
  start?: string;
  end?: string;
  headful?: boolean;
}

function parseBooleanOption(value: string): boolean {
  return value !== "false";
}

function isCorruptedGlyphError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("anti-bot glyphs");
}

function isChallengeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("CAPTCHA/challenge page");
}

function isAutoChallengeError(error: unknown): boolean {
  return isChallengeError(error) && !isForbiddenError(error);
}

function isForbiddenError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Forbidden page");
}

function isTargetClosedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Target page, context or browser has been closed");
}

function envCrawlOptions(): CrawlOptions {
  if (!env.STORY_URL) {
    throw new Error("Missing STORY_URL in .env. Add STORY_URL=https://truyendich.live/doc-truyen/...");
  }
  return {
    url: env.STORY_URL,
    start: env.START_CHAPTER === undefined ? undefined : String(env.START_CHAPTER),
    end: env.END_CHAPTER === undefined ? undefined : String(env.END_CHAPTER),
    headful: env.HEADFUL
  };
}

function chapterUrlFromStoryUrl(storyUrl: string, number: number): string {
  return `${storyUrl.replace(/\/+$/, "")}/chuong-${number}`;
}

function selectRequestedChapters(chapters: ChapterLink[], story: StoryMetadata, options: CrawlOptions): ChapterLink[] {
  const start = options.start ? Number(options.start) : undefined;
  const end = options.end ? Number(options.end) : undefined;
  const selected = selectChapterRange(chapters, start, end);
  if (start === undefined || end === undefined) return selected;

  const byNumber = new Map(selected.map((chapter) => [chapter.number, chapter]));
  for (let number = start; number <= end; number += 1) {
    if (byNumber.has(number)) continue;
    byNumber.set(number, {
      number,
      title: `Chapter ${number}`,
      url: chapterUrlFromStoryUrl(story.url, number)
    });
  }

  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

async function saveBatch(story: StoryMetadata, batch: ParsedChapter[]): Promise<void> {
  if (batch.length === 0) return;
  const filePath = await writeChapterBatchFile(story, batch);
  logger.info({ filePath, chapters: batch.map((chapter) => chapter.number) }, "Saved chapter batch");
}

function batchStartForChapter(number: number): number {
  return Math.floor((number - 1) / env.CHAPTERS_PER_FILE) * env.CHAPTERS_PER_FILE + 1;
}

async function trySaveAlignedBatch(
  story: StoryMetadata,
  allLinks: ChapterLink[],
  cache: Map<number, ParsedChapter>,
  number: number
): Promise<void> {
  if (env.CHAPTERS_PER_FILE <= 1) return;

  const start = batchStartForChapter(number);
  const total = story.totalChapters ?? Math.max(...allLinks.map((link) => link.number));
  const end = Math.min(start + env.CHAPTERS_PER_FILE - 1, total);
  const links = allLinks.filter((link) => link.number >= start && link.number <= end).sort((a, b) => a.number - b.number);
  const progress = await readProgress();
  const chapters: ParsedChapter[] = [];

  for (const link of links) {
    const cached = cache.get(link.number);
    if (cached) {
      chapters.push(cached);
      continue;
    }
    const completed = await readCompletedChapter(progress, link);
    if (!completed) return;
    cache.set(completed.number, completed);
    chapters.push(completed);
  }

  if (chapters.length === links.length && chapters.length > 0) {
    await saveBatch(story, chapters);
  }
}

async function readCompletedChapter(progress: CrawlProgress, link: ChapterLink): Promise<ParsedChapter | undefined> {
  const existing = progress.chapters[String(link.number)];
  if (!existing?.filePath || existing.url !== link.url) return undefined;

  let raw: string;
  try {
    raw = await fs.readFile(existing.filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn({ chapter: link.number, filePath: existing.filePath }, "Completed chapter file is missing; recrawling");
      return undefined;
    }
    throw error;
  }
  const markers = ["\nN\u1ed8I DUNG\n", "\nNá»˜I DUNG\n"];
  const marker = markers.find((candidate) => raw.includes(candidate));
  const content = marker ? raw.slice(raw.lastIndexOf(marker) + marker.length).trim() : raw.trim();

  return {
    number: link.number,
    title: existing.title || link.title,
    url: link.url,
    content
  };
}

async function inspect(url: string): Promise<void> {
  assertTruyendichUrl(url, env.TRUYENDICH_BASE_URL);
  const browser = await createBrowserHandle(true);
  try {
    const response = await browser.page.goto(url, { waitUntil: "domcontentloaded" });
    const screenshotPath = await writeScreenshot("inspect", browser.page);
    await saveStorageState(browser.context);
    logger.info({
      status: response?.status(),
      finalUrl: browser.page.url(),
      title: await browser.page.title(),
      screenshotPath
    });
  } finally {
    await browser.close();
  }
}

async function crawl(options: CrawlOptions): Promise<void> {
  assertTruyendichUrl(options.url, env.TRUYENDICH_BASE_URL);
  const limiter = new RateLimiter();
  const chapterCache = new Map<number, ParsedChapter>();

  const storyBrowser = await createBrowserHandle(options.headful ?? true);
  let story: StoryMetadata;
  let selected: ChapterLink[];
  let allLinks: ChapterLink[];
  try {
    const result = await crawlStory(storyBrowser.page, options.url);
    story = result.story;
    allLinks = result.chapters;
    await saveStorageState(storyBrowser.context);
    selected = selectRequestedChapters(allLinks, story, options);
    allLinks = [...new Map([...allLinks, ...selected].map((chapter) => [chapter.number, chapter])).values()].sort(
      (a, b) => a.number - b.number
    );
  } finally {
    await storyBrowser.close();
  }

  let chapterBrowser: Awaited<ReturnType<typeof createBrowserHandle>> | undefined;
  let crawledInCurrentBrowser = 0;

  try {
    for (const link of selected) {
      const progress = await readProgress();
      if (isCompleted(progress, link)) {
        const chapter = await readCompletedChapter(progress, link);
        if (chapter) {
          logger.info({ chapter: link.number }, "Skipped completed chapter");
          chapterCache.set(chapter.number, chapter);
          await trySaveAlignedBatch(story, allLinks, chapterCache, link.number);
          continue;
        }
      }

      let chapter: ParsedChapter | undefined;
      let corruptedGlyphRetries = 0;
      let targetClosedRetries = 0;
      let challengeRetries = 0;
      while (true) {
        try {
          if (!chapterBrowser || crawledInCurrentBrowser >= env.CHAPTERS_PER_BROWSER) {
            if (chapterBrowser) {
              await chapterBrowser.close();
            }
            chapterBrowser = await createBrowserHandle(options.headful ?? true);
            crawledInCurrentBrowser = 0;
          }
          chapter = await crawlChapter(chapterBrowser.page, story, link);
          await saveStorageState(chapterBrowser.context);
          crawledInCurrentBrowser += 1;
          break;
        } catch (error) {
          if (isForbiddenError(error) && challengeRetries < env.CHALLENGE_BROWSER_RETRIES) {
            challengeRetries += 1;
            logger.warn(
              { chapter: link.number, retry: challengeRetries, maxRetries: env.CHALLENGE_BROWSER_RETRIES },
              "Forbidden page detected; closing browser and retrying chapter"
            );
            await chapterBrowser?.close().catch(() => undefined);
            chapterBrowser = undefined;
            crawledInCurrentBrowser = 0;
            continue;
          }
          if (isAutoChallengeError(error) && challengeRetries < env.CHALLENGE_BROWSER_RETRIES) {
            challengeRetries += 1;
            const cooldownSeconds = env.CHALLENGE_BROWSER_COOLDOWN_SECONDS * challengeRetries;
            logger.warn(
              {
                chapter: link.number,
                retry: challengeRetries,
                maxRetries: env.CHALLENGE_BROWSER_RETRIES,
                cooldownSeconds
              },
              "Auto challenge did not clear; closing browser and retrying chapter"
            );
            await chapterBrowser?.close().catch(() => undefined);
            chapterBrowser = undefined;
            crawledInCurrentBrowser = 0;
            await sleep(cooldownSeconds * 1000);
            continue;
          }
          if (isTargetClosedError(error) && targetClosedRetries < 3) {
            targetClosedRetries += 1;
            logger.warn(
              { chapter: link.number, retry: targetClosedRetries, maxRetries: 3 },
              "Browser was closed; reopening browser and retrying chapter"
            );
            await chapterBrowser?.close().catch(() => undefined);
            chapterBrowser = undefined;
            crawledInCurrentBrowser = 0;
            continue;
          }
          if (isCorruptedGlyphError(error) && corruptedGlyphRetries < env.CORRUPTED_GLYPH_RETRIES) {
            corruptedGlyphRetries += 1;
            const cooldownSeconds = env.CORRUPTED_GLYPH_COOLDOWN_SECONDS * corruptedGlyphRetries;
            logger.warn(
              {
                chapter: link.number,
                retry: corruptedGlyphRetries,
                maxRetries: env.CORRUPTED_GLYPH_RETRIES,
                cooldownSeconds
              },
              "Corrupted glyph content detected; cooling down before retrying chapter"
            );
            if (chapterBrowser) {
              await saveStorageState(chapterBrowser.context);
            }
            await sleep(cooldownSeconds * 1000);
            continue;
          }
          if (isCorruptedGlyphError(error)) {
            logger.warn(
              { chapter: link.number, retries: corruptedGlyphRetries, maxRetries: env.CORRUPTED_GLYPH_RETRIES },
              "Stopping crawler on corrupted glyph chapter after max retries"
            );
            await upsertChapterProgress({
              number: link.number,
              title: link.title,
              url: link.url,
              status: "failed",
              retryCount: corruptedGlyphRetries,
              errorMessage: `Noi dung rac/anti-bot glyphs after ${env.CORRUPTED_GLYPH_RETRIES} cooldown retries`,
              updatedAt: new Date().toISOString()
            });
            await chapterBrowser?.close();
            chapterBrowser = undefined;
            crawledInCurrentBrowser = 0;
            throw error;
          }
          throw error;
        } finally {
          if (crawledInCurrentBrowser >= env.CHAPTERS_PER_BROWSER) {
            await chapterBrowser?.close();
            chapterBrowser = undefined;
            if (env.CLEAR_SESSION_AFTER_BROWSER) {
              await clearStorageState();
              logger.info({ chapters: env.CHAPTERS_PER_BROWSER }, "Cleared browser session after chapter group");
            }
          }
        }
      }

      if (!chapter) {
        throw new Error(`Chapter ${link.number} was not crawled`);
      }

      chapterCache.set(chapter.number, chapter);
      await trySaveAlignedBatch(story, allLinks, chapterCache, link.number);
      await limiter.afterChapter();
    }
  } finally {
    await chapterBrowser?.close();
  }
}

async function status(): Promise<void> {
  const progress = await readProgress();
  const values = Object.values(progress.chapters);
  logger.info({
    story: progress.story?.title,
    totalTracked: values.length,
    completed: values.filter((chapter) => chapter.status === "completed").length,
    failed: values.filter((chapter) => chapter.status === "failed").length,
    blocked: values.filter((chapter) => chapter.status === "blocked").length,
    challenge: values.filter((chapter) => chapter.status === "challenge").length
  });
}

export async function runCli(): Promise<void> {
  await ensureProjectDirs();
  const program = new Command();
  program.name("truyendich-crawler").description("File-based crawler for truyendich.live");
  program.action(async () => {
    await crawl(envCrawlOptions());
  });

  program.command("inspect").requiredOption("--url <url>").action(async (options: { url: string }) => {
    await inspect(options.url);
  });

  program
    .command("crawl")
    .requiredOption("--url <url>")
    .option("--start <number>")
    .option("--end <number>")
    .option("--headful <boolean>", "Run browser with visible window", parseBooleanOption)
    .action(async (options: CrawlOptions) => {
      await crawl(options);
    });

  program.command("resume").action(async () => {
    const progress = await readProgress();
    if (!progress.story?.url) throw new Error("No story URL found in data/progress.json");
    await crawl({ url: progress.story.url });
  });

  program.command("status").action(status);

  program.command("retry-failed").action(async () => {
    logger.warn("retry-failed is not implemented yet.");
  });

  await program.parseAsync(process.argv);
}
