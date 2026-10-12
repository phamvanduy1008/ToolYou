export const selectors = {
  storyTitle: ["h1", ".story-title", ".novel-title", "[class*=title] h1"],
  storyAuthor: ["a[href*='tac-gia']", ".author", "[class*=author]"],
  storyStatus: [".status", "[class*=status]"],
  coverImage: ["img[alt][src]", ".cover img", "[class*=cover] img"],
  chapterLinks: ["a[href*='/doc-truyen/'][href*='chuong']", "a[href*='chuong']"],
  chapterTitle: ["h1", ".chapter-title", ".chapter-name", "[class*=chapter] h1"],
  chapterContent: [
    "section[itemprop='text']",
    ".prose-novel",
    "#original-content-tab",
    ".chapter-content",
    ".reading-content",
    "#chapter-content",
    "article",
    "[class*=content]"
  ]
} as const;
