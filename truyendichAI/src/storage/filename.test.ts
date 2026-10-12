import { describe, expect, it } from "vitest";
import { chapterFileName, safeSegment } from "./filename.js";

describe("filename helpers", () => {
  it("removes Windows-forbidden characters", () => {
    expect(safeSegment("Chuong 1: A/B<C>|D?*")).toBe("chuong-1-abcd");
  });

  it("uses chapter number only for chapter file names", () => {
    expect(chapterFileName(12, "Chapter 12")).toBe("12.txt");
  });
});
