import type { Page } from "playwright";
import { parseStory } from "../parsers/story-parser.js";
import { saveStoryProgress } from "../storage/progress-store.js";
import { writeMetadata } from "../storage/file-writer.js";
import type { ChapterLink, StoryMetadata } from "../types/index.js";

export async function crawlStory(page: Page, url: string): Promise<{ story: StoryMetadata; chapters: ChapterLink[] }> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const html = await page.content();
  const result = parseStory(html, page.url());
  await writeMetadata(result.story);
  await saveStoryProgress(result.story);
  return result;
}
