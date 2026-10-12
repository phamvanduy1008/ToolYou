import * as cheerio from "cheerio";
import { normalizeWhitespace } from "../utils/text.js";

const leadingChapterHeadingPattern = /^(?:ch\u01b0\u01a1ng|chuong)\s+\d+\b/i;
const junkTokenPattern = /^(?:ad|ads|advert|advertisement|breadcrumb|navigation)(?:[-_]|$)/i;

function removeLeadingChapterHeading(lines: string[]): string[] {
  const [firstLine, ...remainingLines] = lines;
  if (firstLine && leadingChapterHeadingPattern.test(firstLine.normalize("NFC"))) {
    return remainingLines;
  }
  return lines;
}

function hasJunkToken(value: string | undefined): boolean {
  return (value ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => junkTokenPattern.test(token));
}

export function cleanContentHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, nav, header, footer, button, form").remove();
  $("[class], [id]").each((_, element) => {
    const match = $(element);
    if (hasJunkToken(match.attr("class")) || hasJunkToken(match.attr("id"))) {
      match.remove();
    }
  });
  $("br").replaceWith("\n");
  $("p, div, section, article, li").each((_, element) => {
    $(element).append("\n");
  });
  const lines = $.root()
    .text()
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  return normalizeWhitespace([...new Set(removeLeadingChapterHeading(lines))].join("\n\n"));
}
