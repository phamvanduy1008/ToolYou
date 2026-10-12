import { detectChallenge } from "./challenge-detector.js";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const corruptedGlyphPattern = /[\u{13000}-\u{1342F}\u995F]/gu;
const minCorruptedGlyphs = 3;

export function detectCorruptedGlyphContent(content: string): boolean {
  const matches = content.match(corruptedGlyphPattern);
  return (matches?.length ?? 0) >= minCorruptedGlyphs;
}

export function validateChapter(title: string, content: string, html: string): ValidationResult {
  if (!title.trim()) return { ok: false, reason: "Thi\u1ebfu ti\u00eau \u0111\u1ec1 ch\u01b0\u01a1ng" };
  if (detectCorruptedGlyphContent(content)) {
    return { ok: false, reason: detectChallenge(html) ? "CAPTCHA/challenge page" : "Noi dung rac/anti-bot glyphs" };
  }
  if (content.trim().length >= 300) return { ok: true };
  if (detectChallenge(html)) return { ok: false, reason: "CAPTCHA/challenge page" };
  return { ok: false, reason: "N\u1ed9i dung ch\u01b0\u01a1ng qu\u00e1 ng\u1eafn" };
}
