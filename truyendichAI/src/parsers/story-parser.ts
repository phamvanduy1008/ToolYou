import * as cheerio from "cheerio";
import { selectors } from "../config/selectors.js";
import type { ChapterLink, StoryMetadata } from "../types/index.js";
import { firstNonEmpty } from "../utils/text.js";
import { parseChapterNumber, slugFromUrl, toAbsoluteUrl } from "../utils/url.js";

function firstText($: cheerio.CheerioAPI, candidates: readonly string[]): string | undefined {
  return firstNonEmpty(candidates.map((selector) => $(selector).first().text()));
}

export function parseStory(html: string, url: string): { story: StoryMetadata; chapters: ChapterLink[] } {
  const $ = cheerio.load(html);
  const title = firstText($, selectors.storyTitle) ?? $("title").text().trim() ?? slugFromUrl(url);
  const author = firstText($, selectors.storyAuthor);
  const status = firstText($, selectors.storyStatus);
  const coverUrl = $(selectors.coverImage.join(",")).first().attr("src");
  const seen = new Set<string>();
  const chapters: ChapterLink[] = [];

  $(selectors.chapterLinks.join(",")).each((index, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const absoluteUrl = toAbsoluteUrl(href, url);
    if (seen.has(absoluteUrl)) return;
    seen.add(absoluteUrl);
    const number = parseChapterNumber(absoluteUrl, index + 1);
    chapters.push({
      number,
      title: $(element).text().trim() || `Chương ${number}`,
      url: absoluteUrl
    });
  });

  return {
    story: {
      url,
      slug: slugFromUrl(url),
      title,
      author,
      status,
      totalChapters: chapters.length || undefined,
      coverUrl: coverUrl ? toAbsoluteUrl(coverUrl, url) : undefined,
      crawledAt: new Date().toISOString()
    },
    chapters
  };
}
