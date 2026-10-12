const CryptoJS = require("crypto-js");
const config = require("../config");

const APP_KEY_SPEC = "T5Hr41U5jKTTrtUOXdYZnyx3wjZEKUoxv16Clwwu4D5zIbd0-q9sdfh";
const CONTENT_KEY_SPEC = "G5sA7dL2K9fV3hQ1Zr8wX6pR0jN4uYtM7iC3vB9oS6xE2qLK-mKasbbZ";
const APP_KEY = buildAppKey(APP_KEY_SPEC);
const CONTENT_GLOBAL_KEY = buildContentGlobalKey(CONTENT_KEY_SPEC);

function buildContentGlobalKey(spec) {
  const [left, right] = String(spec).split("-");
  const shift = right.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return left
    .split("")
    .map((char) => String.fromCharCode(((char.charCodeAt(0) - 65 + shift) % 26) + 65))
    .join("");
}

function rotateAlpha(char, shift) {
  const code = char.charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(((code - 65 + shift) % 26) + 65);
  if (code >= 97 && code <= 122) return String.fromCharCode(((code - 97 + shift) % 26) + 97);
  return char;
}

function buildAppKey(spec) {
  const raw = String(spec || "");
  let left;
  let right;

  if (raw.includes("-")) {
    [left, right] = raw.split("-");
    left ||= "default";
    right ||= "0000";
  } else {
    const mid = Math.ceil(raw.length / 2);
    left = raw.slice(0, mid) || "default";
    right = raw.slice(mid) || "0000";
  }

  const factor = right.split("").reduce((total, char) => (total * char.charCodeAt(0)) % 255, 1);
  return left
    .split("")
    .map((char, index) => rotateAlpha(char, (factor + index * char.charCodeAt(0)) % 26))
    .join("");
}

function isEncrypted(value) {
  return typeof value === "string" && value.trim().startsWith("U2FsdGVkX1");
}

function uniq(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function decryptAes(cipherText, key) {
  if (!cipherText || !key) return "";

  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (_) {
    return "";
  }
}

function looksUsefulPlainText(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 20 && /[<>{}\p{L}]/u.test(trimmed);
}

function extractCandidateKeysFromScripts(scripts) {
  const keys = [];

  for (const script of scripts) {
    const source = typeof script === "string" ? script : script.source;
    if (!source) continue;

    const decryptCallRegex = /(?:CryptoJS\.)?AES\.decrypt\([^,]+,\s*["'`]([^"'`]{3,})["'`]/g;
    const keyNearRegex = /key_encrypt[\s\S]{0,300}?["'`]([A-Za-z0-9_\-:+/=.]{4,})["'`]/g;
    const contentCompNearRegex = /content_comp[\s\S]{0,300}?["'`]([A-Za-z0-9_\-:+/=.]{4,})["'`]/g;

    for (const regex of [decryptCallRegex, keyNearRegex, contentCompNearRegex]) {
      let match;
      while ((match = regex.exec(source))) {
        const value = match[1];
        if (!value.includes("U2FsdGVkX1") && value.length <= 128) {
          keys.push(value);
        }
      }
    }
  }

  return uniq(keys);
}

function collectCandidateKeys(chapter = {}, scripts = []) {
  const candidates = [
    config.decryptKey,
    APP_KEY,
    CONTENT_GLOBAL_KEY,
    "T5Hr41U5jKTTrtUOXdYZnyx3wjZEKUoxv16Clwwu4D5zIbd0",
    chapter.key,
    chapter.secret,
    chapter.decrypt_key,
    chapter.key_decrypt
  ];

  if (chapter.key_encrypt && !isEncrypted(chapter.key_encrypt)) {
    candidates.push(chapter.key_encrypt);
  }

  candidates.push(...extractCandidateKeysFromScripts(scripts));

  const firstPass = uniq(candidates);
  const derived = [];

  if (isEncrypted(chapter.key_encrypt)) {
    for (const key of firstPass) {
      const plainKey = decryptAes(chapter.key_encrypt, key);
      if (plainKey) derived.push(plainKey);
    }
  }

  return uniq([...firstPass, ...derived]);
}

function tryParseJson(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function decryptToPlain(value, keys) {
  if (!isEncrypted(value)) {
    return typeof value === "string" ? value : "";
  }

  for (const key of keys) {
    const plain = decryptAes(value, key);
    if (looksUsefulPlainText(plain)) {
      return plain;
    }
  }

  return "";
}

function decryptJson(value, keys) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;

  const direct = tryParseJson(value);
  if (direct) return direct;

  for (const key of keys) {
    const plain = decryptAes(value, key);
    const parsed = tryParseJson(plain);
    if (parsed) return parsed;
  }

  return null;
}

function decryptObjectValues(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" && isEncrypted(item) ? decryptToPlain(item, keys) || item : item
    ])
  );
}

function resolveRuntimeContentKey(pageProps, scripts = []) {
  const chapter = pageProps?.chapter || pageProps || {};
  const keys = collectCandidateKeys(chapter, scripts);
  const decryptedRs = decryptObjectValues(pageProps?.rs || chapter.rs || {}, keys);
  const ri = decryptToPlain(pageProps?.ri, keys) || pageProps?.ri;
  const commentCount = pageProps?.comment_count ?? pageProps?.commentCount ?? 0;
  const rsValue = decryptedRs?.[ri];

  return decryptAes(chapter.key_encrypt, `${rsValue}${commentCount}`);
}

function resolveChapterContent(pagePropsOrChapter, scripts = []) {
  const pageProps = pagePropsOrChapter?.chapter ? pagePropsOrChapter : null;
  const originalChapter = pageProps?.chapter || pagePropsOrChapter || {};
  const chapterVariants = pageProps ? resolveChapterObjectVariants(pageProps, scripts) : [originalChapter];
  const chapter = chapterVariants[0] || originalChapter;
  const keys = collectCandidateKeys(chapter, scripts);
  const runtimeKeys = pageProps ? resolveRuntimeContentKeys(pageProps, scripts, chapterVariants) : [];
  const contentKeys = uniq([...runtimeKeys, ...keys]);
  const fields = chapterVariants.flatMap((item) => [item.content, item.content_comp, item.data, item.body]);

  for (const value of fields) {
    if (!value) continue;

    if (!isEncrypted(value) && looksUsefulPlainText(value)) {
      return { html: value, key: "", encrypted: false };
    }

    for (const key of contentKeys) {
      const plain = decryptAes(value, key);
      if (looksUsefulPlainText(plain)) {
        return { html: plain, key, encrypted: true };
      }
    }
  }

  return { html: "", key: "", encrypted: fields.some(isEncrypted) };
}

function getChapterBaseKeys(pageProps, scripts = []) {
  const chapter = pageProps?.chapter || pageProps || {};
  const keys = collectCandidateKeys(chapter, scripts);
  const decryptedRs = decryptObjectValues(pageProps?.rs || chapter.rs || {}, keys);
  const ri = decryptToPlain(pageProps?.ri, keys) || pageProps?.ri;
  const commentCount = pageProps?.comment_count ?? pageProps?.commentCount ?? 0;
  const commentVariants = uniq([
    commentCount,
    Array.isArray(commentCount) ? commentCount.length : "",
    0,
    ""
  ]);
  const rsVariants = uniq([
    decryptedRs?.[ri],
    "undefined",
    ...Object.values(decryptedRs || {})
  ]);
  const baseKeys = [];

  for (const rsValue of rsVariants) {
    for (const comment of commentVariants) {
      baseKeys.push(`${rsValue}${comment}`);
    }
  }

  return uniq(baseKeys);
}

function decryptObjectWithKey(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([field, item]) => [
      field,
      typeof item === "string" && isEncrypted(item) ? decryptAes(item, key) : item
    ])
  );
}

function resolveChapterObjectVariants(pageProps, scripts = []) {
  const chapter = pageProps?.chapter || {};
  const variants = [chapter];

  for (const baseKey of getChapterBaseKeys(pageProps, scripts)) {
    const decrypted = decryptObjectWithKey(chapter, baseKey);
    if (decrypted && decrypted !== chapter) {
      if (!decrypted.content && pageProps.contentEncrypt) decrypted.content = pageProps.contentEncrypt;
      variants.push(decrypted);
    }
  }

  return variants;
}

function resolveRuntimeContentKeys(pageProps, scripts = [], chapterVariants = null) {
  const chapter = pageProps?.chapter || pageProps || {};
  const keys = collectCandidateKeys(chapter, scripts);
  const baseKeys = getChapterBaseKeys(pageProps, scripts);
  const variants = chapterVariants || resolveChapterObjectVariants(pageProps, scripts);
  const runtimeKeys = [];

  for (const variant of variants) {
    for (const baseKey of baseKeys) {
      const key = decryptAes(variant.key_encrypt, baseKey);
      if (key) {
        runtimeKeys.push(key);
        for (const baseKey of keys) {
          const nested = decryptAes(key, baseKey);
          if (nested) runtimeKeys.push(nested);
        }
      }
    }
  }

  return uniq(runtimeKeys);
}

module.exports = {
  APP_KEY,
  CONTENT_GLOBAL_KEY,
  isEncrypted,
  decryptAes,
  decryptToPlain,
  decryptJson,
  decryptObjectValues,
  decryptObjectWithKey,
  resolveChapterObjectVariants,
  resolveRuntimeContentKey,
  resolveRuntimeContentKeys,
  collectCandidateKeys,
  extractCandidateKeysFromScripts,
  resolveChapterContent
};
