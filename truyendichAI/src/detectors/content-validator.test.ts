import { describe, expect, it } from "vitest";
import { validateChapter } from "./content-validator.js";

describe("validateChapter", () => {
  it("rejects missing title", () => {
    const result = validateChapter("", "a".repeat(400), "<article></article>");
    expect(result.ok).toBe(false);
  });

  it("rejects short content", () => {
    const result = validateChapter("Chuong 1", "ngan", "<article>ngan</article>");
    expect(result.ok).toBe(false);
  });

  it("accepts valid chapter content", () => {
    const result = validateChapter("Chuong 1", "noi dung ".repeat(60), "<article>ok</article>");
    expect(result.ok).toBe(true);
  });

  it("accepts clean content even when challenge text remains elsewhere in html", () => {
    const result = validateChapter(
      "Chuong 1",
      "noi dung sach ".repeat(60),
      "<main>x\u00e1c th\u1ef1c th\u1ea5t b\u1ea1i</main>"
    );

    expect(result.ok).toBe(true);
  });

  it("rejects Egyptian hieroglyph anti-bot garbage", () => {
    const result = validateChapter("Chuong 1", "\u{13080}\u{130C0}\u{131CB} ".repeat(120), "<article>ok</article>");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("anti-bot glyphs");
  });

  it("classifies challenge pages before corrupted glyph content", () => {
    const result = validateChapter(
      "Chuong 1",
      "\u{13080}\u{130C0}\u{131CB} ".repeat(120),
      "<main>x\u00e1c th\u1ef1c th\u1ea5t b\u1ea1i</main>"
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("challenge");
  });

  it("rejects repeated mojibake glyph garbage", () => {
    const result = validateChapter("Chuong 1", "饟個饟儉饟噵 ".repeat(120), "<article>ok</article>");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("anti-bot glyphs");
  });
});
