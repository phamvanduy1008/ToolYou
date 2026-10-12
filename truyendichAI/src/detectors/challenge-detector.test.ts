import { describe, expect, it } from "vitest";
import { detectChallenge } from "./challenge-detector.js";

describe("detectChallenge", () => {
  it("detects common challenge text", () => {
    expect(detectChallenge("<html>Checking your browser before accessing</html>")).toBe(true);
  });

  it("detects active security verification", () => {
    expect(detectChallenge('<div class="mystic-cipher">cipher text</div><h3>Xac thuc bao mat</h3>')).toBe(true);
  });

  it("does not flag normal chapter html", () => {
    expect(detectChallenge("<article>Day la noi dung chuong binh thuong.</article>")).toBe(false);
  });

  it("does not flag inactive verification metadata on a readable chapter", () => {
    const html = `
      <section itemprop="text">Day la noi dung chuong binh thuong da hien ra.</section>
      <script>self.__next_f.push([1, '"turnstileSiteKey":"site","chapter_token":"abc"'])</script>
    `;
    expect(detectChallenge(html)).toBe(false);
  });
});
