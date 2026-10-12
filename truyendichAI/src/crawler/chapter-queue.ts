import type { ChapterLink } from "../types/index.js";

export function selectChapterRange(chapters: ChapterLink[], start?: number, end?: number): ChapterLink[] {
  return chapters
    .filter((chapter) => start === undefined || chapter.number >= start)
    .filter((chapter) => end === undefined || chapter.number <= end)
    .sort((a, b) => a.number - b.number);
}
