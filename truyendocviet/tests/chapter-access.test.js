"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REASONS,
  createChapterAccessService,
} = require("../services/chapterAccessService");

const NOW = new Date("2026-07-11T00:00:00.000Z");

function makeDb(overrides = {}) {
  const chapters = new Map([
    ["free-1", { id: "free-1", storyId: "story-a", isVip: false }],
    ["vip-1", { id: "vip-1", storyId: "story-a", isVip: true }],
    ["vip-2", { id: "vip-2", storyId: "story-b", isVip: true }],
  ]);

  const users = new Map([
    ["normal", { id: "normal", status: "active" }],
    ["vip", { id: "vip", status: "active" }],
    ["expired", { id: "expired", status: "active" }],
    ["blocked", { id: "blocked", status: "blocked" }],
    ["buyer-story", { id: "buyer-story", status: "active" }],
    ["buyer-chapter", { id: "buyer-chapter", status: "active" }],
    ["pending", { id: "pending", status: "active" }],
    ["failed", { id: "failed", status: "active" }],
    ["wrong-story", { id: "wrong-story", status: "active" }],
  ]);

  const db = {
    async getChapterById(id) {
      return chapters.get(String(id)) || null;
    },
    async getUserById(id) {
      return users.get(String(id)) || null;
    },
    async getActiveVip(userId) {
      if (userId === "vip") {
        return { status: "active", expiresAt: "2026-08-01T00:00:00.000Z" };
      }
      if (userId === "expired") {
        return { status: "active", expiresAt: "2026-01-01T00:00:00.000Z" };
      }
      return null;
    },
    async getStoryPurchase(userId, storyId) {
      if (userId === "buyer-story" && storyId === "story-a") {
        return { status: "paid" };
      }
      if (userId === "wrong-story" && storyId === "story-b") {
        return { status: "paid" };
      }
      if (userId === "pending") {
        return { status: "pending" };
      }
      if (userId === "failed") {
        return { status: "failed" };
      }
      return null;
    },
    async getChapterPurchase(userId, chapterId) {
      if (userId === "buyer-chapter" && chapterId === "vip-1") {
        return { status: "paid" };
      }
      return null;
    },
    ...overrides,
  };

  return db;
}

async function check(userId, chapterId, db = makeDb()) {
  const service = createChapterAccessService(db, { getNow: () => NOW });
  return service.canReadChapter(userId, chapterId);
}

test("free chapter is readable without login", async () => {
  const result = await check(null, "free-1");
  assert.equal(result.allowed, true);
  assert.equal(result.reason, REASONS.FREE_CHAPTER);
});

test("missing user on vip chapter is unauthenticated", async () => {
  const result = await check(null, "vip-1");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, REASONS.UNAUTHENTICATED);
  assert.equal(result.status, 401);
});

test("active VIP can read vip chapter", async () => {
  const result = await check("vip", "vip-1");
  assert.equal(result.allowed, true);
  assert.equal(result.reason, REASONS.ACTIVE_VIP);
});

test("expired VIP cannot read vip chapter", async () => {
  const result = await check("expired", "vip-1");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, REASONS.VIP_EXPIRED);
});

test("story purchase grants same story access", async () => {
  const result = await check("buyer-story", "vip-1");
  assert.equal(result.allowed, true);
  assert.equal(result.reason, REASONS.STORY_PURCHASED);
});

test("chapter purchase grants exact chapter access", async () => {
  const result = await check("buyer-chapter", "vip-1");
  assert.equal(result.allowed, true);
  assert.equal(result.reason, REASONS.CHAPTER_PURCHASED);
});

test("pending payment does not grant access", async () => {
  const result = await check("pending", "vip-1");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, REASONS.PAYMENT_PENDING);
});

test("failed payment does not grant access", async () => {
  const result = await check("failed", "vip-1");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, REASONS.PAYMENT_FAILED);
});

test("blocked account cannot read vip chapter", async () => {
  const result = await check("blocked", "vip-1");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, REASONS.ACCOUNT_BLOCKED);
});

test("missing chapter returns 404 style result", async () => {
  const result = await check("vip", "missing");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, REASONS.CHAPTER_NOT_FOUND);
  assert.equal(result.status, 404);
});

test("purchase for another story does not grant access", async () => {
  const result = await check("wrong-story", "vip-1");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, REASONS.VIP_REQUIRED);
});

test("purchase for another chapter does not grant access", async () => {
  const result = await check("buyer-chapter", "vip-2");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, REASONS.VIP_REQUIRED);
});
