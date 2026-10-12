import * as cheerio from "cheerio";
import { selectors } from "../config/selectors.js";
import type { ParsedChapter } from "../types/index.js";
import { cleanContentHtml } from "./content-cleaner.js";

function firstMatchingHtml($: cheerio.CheerioAPI, candidates: readonly string[]): string | undefined {
  for (const selector of candidates) {
    const match = $(selector).first();
    if (match.length > 0) return $.html(match);
  }
  return undefined;
}

export function parseChapter(html: string, url: string, number: number): ParsedChapter {
  const $ = cheerio.load(html);
  const title =
    selectors.chapterTitle.map((selector) => $(selector).first().text().trim()).find(Boolean) ?? `Chương ${number}`;
  const contentHtml = firstMatchingHtml($, selectors.chapterContent) ?? "";
  return {
    number,
    title,
    url,
    content: cleanContentHtml(contentHtml)
  };
}
