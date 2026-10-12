const CHALLENGE_KEYWORDS = [
  "captcha",
  "verify you are human",
  "checking your browser",
  "just a moment",
  "access denied",
  "forbidden",
  "too many requests",
  "cloudflare",
  "trust_challenge\":\"verify_now",
  "trust_challenge&quot;:&quot;verify_now",
  "mystic-cipher",
  "/cdn-cgi/challenge-platform/",
  "xác thực bảo mật",
  "xĂ¡c thá»±c báº£o máº­t",
  "x\u00e1c th\u1ef1c th\u1ea5t b\u1ea1i",
  "vui l\u00f2ng t\u1ea3i l\u1ea1i trang",
  "h\u1ec7 th\u1ed1ng kh\u00f4ng th\u1ec3 x\u00e1c th\u1ef1c",
  "x\u00e1c minh b\u1ea1n l\u00e0 con ng\u01b0\u1eddi",
  "truy c\u1eadp b\u1ecb t\u1eeb ch\u1ed1i"
];

export function detectChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return CHALLENGE_KEYWORDS.some((keyword) => lower.includes(keyword));
}
