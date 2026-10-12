import { describe, expect, it } from "vitest";
import { cleanContentHtml } from "./content-cleaner.js";

describe("cleanContentHtml", () => {
  it("removes script/style/nav and keeps chapter text", () => {
    const result = cleanContentHtml(`
      <article>
        <style>.x{}</style>
        <script>alert(1)</script>
        <nav>next</nav>
        <p>Dòng một.</p>
        <p>Dòng hai.</p>
      </article>
    `);

    expect(result).toContain("Dòng một.");
    expect(result).toContain("Dòng hai.");
    expect(result).not.toContain("alert");
    expect(result).not.toContain("next");
  });

  it("does not remove content wrapped by tailwind leading-relaxed class", () => {
    const result = cleanContentHtml(`
      <section class="prose-novel leading-relaxed">
        <p>Noi dung that.</p>
        <div class="ads-banner">quang cao</div>
      </section>
    `);

    expect(result).toBe("Noi dung that.");
    expect(result).not.toContain("quang cao");
  });

  it("removes a leading Vietnamese chapter heading from content", () => {
    const result = cleanContentHtml(`
      <article>
        <p>Ch\u01b0\u01a1ng 1: T\u1ef7 t\u1ef7 thay g\u1ea3</p>
        <p>Noi dung that.</p>
      </article>
    `);

    expect(result).toBe("Noi dung that.");
  });

  it("removes only the heading when minified paragraph tags have no source newlines", () => {
    const result = cleanContentHtml(
      `<section><p>Ch\u01b0\u01a1ng 1: T\u1ef7 t\u1ef7 thay g\u1ea3</p><p>Noi dung that.</p><p>Noi dung tiep.</p></section>`
    );

    expect(result).toBe("Noi dung that.\n\nNoi dung tiep.");
  });

  it("removes a leading unaccented chapter heading from content", () => {
    const result = cleanContentHtml(`
      <article>
        <p>Chuong 12 - Ten chuong</p>
        <p>Noi dung khac.</p>
      </article>
    `);

    expect(result).toBe("Noi dung khac.");
  });

  it("keeps the first line when it does not start with chapter and number", () => {
    const result = cleanContentHtml(`
      <article>
        <p>Chuong nay bat dau bang loi thoai.</p>
        <p>Noi dung that.</p>
      </article>
    `);

    expect(result).toContain("Chuong nay bat dau bang loi thoai.");
  });
});
