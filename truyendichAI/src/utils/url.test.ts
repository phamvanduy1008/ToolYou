import { describe, expect, it } from "vitest";
import { parseChapterNumber, slugFromUrl, toAbsoluteUrl } from "./url.js";

describe("url helpers", () => {
  it("extracts story slug", () => {
    expect(slugFromUrl("https://truyendich.live/doc-truyen/cuu-vuc-pham-tien")).toBe("cuu-vuc-pham-tien");
  });

  it("builds absolute urls", () => {
    expect(toAbsoluteUrl("/doc-truyen/a/chuong-1", "https://truyendich.live/doc-truyen/a")).toBe(
      "https://truyendich.live/doc-truyen/a/chuong-1"
    );
  });

  it("parses chapter number from url", () => {
    expect(parseChapterNumber("https://truyendich.live/doc-truyen/a/chuong-123", 1)).toBe(123);
  });
});
