"use strict";

const REASONS = Object.freeze({
  FREE_CHAPTER: "FREE_CHAPTER",
  ACTIVE_VIP: "ACTIVE_VIP",
  STORY_PURCHASED: "STORY_PURCHASED",
  CHAPTER_PURCHASED: "CHAPTER_PURCHASED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  VIP_REQUIRED: "VIP_REQUIRED",
  VIP_EXPIRED: "VIP_EXPIRED",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  ACCOUNT_BLOCKED: "ACCOUNT_BLOCKED",
  FORBIDDEN: "FORBIDDEN",
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
});

const HTTP_STATUS_BY_REASON = Object.freeze({
  [REASONS.UNAUTHENTICATED]: 401,
  [REASONS.CHAPTER_NOT_FOUND]: 404,
  [REASONS.ACCOUNT_BLOCKED]: 403,
  [REASONS.VIP_REQUIRED]: 403,
  [REASONS.VIP_EXPIRED]: 403,
  [REASONS.PAYMENT_PENDING]: 403,
  [REASONS.PAYMENT_FAILED]: 403,
  [REASONS.FORBIDDEN]: 403,
});

function isActiveWindow(record, now) {
  if (!record) return false;
  if (record.status && record.status !== "paid" && record.status !== "active") {
    return false;
  }

  if (!record.expiresAt) return true;
  return new Date(record.expiresAt).getTime() > now.getTime();
}

function deny(reason, details = {}) {
  return {
    allowed: false,
    reason,
    status: HTTP_STATUS_BY_REASON[reason] || 403,
    ...details,
  };
}

function allow(reason, details = {}) {
  return {
    allowed: true,
    reason,
    status: 200,
    ...details,
  };
}

function normalizeId(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function createChapterAccessService(db, options = {}) {
  if (!db || typeof db.getChapterById !== "function") {
    throw new Error("createChapterAccessService requires db.getChapterById");
  }

  const getNow = options.getNow || (() => new Date());

  async function canReadChapter(userId, chapterId) {
    const safeChapterId = normalizeId(chapterId).trim();
    if (!safeChapterId) {
      return deny(REASONS.CHAPTER_NOT_FOUND);
    }

    const chapter = await db.getChapterById(safeChapterId);
    if (!chapter) {
      return deny(REASONS.CHAPTER_NOT_FOUND);
    }

    if (!chapter.isVip && !chapter.requiresPurchase) {
      return allow(REASONS.FREE_CHAPTER, {
        chapterId: normalizeId(chapter.id),
        storyId: normalizeId(chapter.storyId),
      });
    }

    const safeUserId = normalizeId(userId).trim();
    if (!safeUserId) {
      return deny(REASONS.UNAUTHENTICATED, {
        chapterId: normalizeId(chapter.id),
        storyId: normalizeId(chapter.storyId),
      });
    }

    const user = db.getUserById
      ? await db.getUserById(safeUserId)
      : { id: safeUserId, status: "active" };

    if (!user) {
      return deny(REASONS.UNAUTHENTICATED);
    }

    if (user.status === "blocked" || user.blocked) {
      return deny(REASONS.ACCOUNT_BLOCKED);
    }

    const now = getNow();
    const vip = db.getActiveVip ? await db.getActiveVip(safeUserId) : null;
    if (isActiveWindow(vip, now)) {
      return allow(REASONS.ACTIVE_VIP, {
        chapterId: normalizeId(chapter.id),
        storyId: normalizeId(chapter.storyId),
      });
    }

    const storyPurchase = db.getStoryPurchase
      ? await db.getStoryPurchase(safeUserId, normalizeId(chapter.storyId))
      : null;

    if (storyPurchase) {
      if (storyPurchase.status === "pending") return deny(REASONS.PAYMENT_PENDING);
      if (storyPurchase.status === "failed" || storyPurchase.status === "refunded") {
        return deny(REASONS.PAYMENT_FAILED);
      }
      if (isActiveWindow(storyPurchase, now)) {
        return allow(REASONS.STORY_PURCHASED, {
          chapterId: normalizeId(chapter.id),
          storyId: normalizeId(chapter.storyId),
        });
      }
    }

    const chapterPurchase = db.getChapterPurchase
      ? await db.getChapterPurchase(safeUserId, normalizeId(chapter.id))
      : null;

    if (chapterPurchase) {
      if (chapterPurchase.status === "pending") return deny(REASONS.PAYMENT_PENDING);
      if (chapterPurchase.status === "failed" || chapterPurchase.status === "refunded") {
        return deny(REASONS.PAYMENT_FAILED);
      }
      if (isActiveWindow(chapterPurchase, now)) {
        return allow(REASONS.CHAPTER_PURCHASED, {
          chapterId: normalizeId(chapter.id),
          storyId: normalizeId(chapter.storyId),
        });
      }
    }

    if (vip && vip.expiresAt && new Date(vip.expiresAt).getTime() <= now.getTime()) {
      return deny(REASONS.VIP_EXPIRED);
    }

    return deny(REASONS.VIP_REQUIRED, {
      chapterId: normalizeId(chapter.id),
      storyId: normalizeId(chapter.storyId),
    });
  }

  return { canReadChapter };
}

module.exports = {
  REASONS,
  HTTP_STATUS_BY_REASON,
  createChapterAccessService,
};
