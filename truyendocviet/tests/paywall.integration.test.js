"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");

const LOCK_MESSAGES = [
  "Vui long dang nhap",
  "Vui lòng đăng nhập",
  "can VIP",
  "cần VIP",
  "VIP",
];

const CONTENT_KEYS = [
  "contentHtml",
  "rawContent",
  "chapterText",
  "encryptedContent",
];

function shouldRun() {
  return Boolean(process.env.VIP_CHAPTER_URL);
}

function decodeEscapes(text) {
  return String(text || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"');
}

test("unauthenticated VIP response does not expose obvious content fields", {
  skip: shouldRun() ? false : "Set VIP_CHAPTER_URL to run integration check",
}, async () => {
  const response = await axios.get(process.env.VIP_CHAPTER_URL, {
    timeout: 30000,
    responseType: "text",
    validateStatus: (status) => status >= 200 && status < 500,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  const body = decodeEscapes(response.data);
  const hasLockMessage = LOCK_MESSAGES.some((message) => body.includes(message));
  assert.equal(hasLockMessage, true, "VIP page should show a lock/login message");

  for (const key of CONTENT_KEYS) {
    assert.equal(
      body.includes(`"${key}"`),
      false,
      `VIP response should not include ${key}`
    );
  }

  assert.equal(
    /"MemberCanReadFull"\s*:\s*true/.test(body),
    false,
    "Unauthenticated response must not claim MemberCanReadFull=true"
  );
});
