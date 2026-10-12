"use strict";

const { HTTP_STATUS_BY_REASON } = require("../services/chapterAccessService");

function sendAccessError(res, result) {
  const status = result.status || HTTP_STATUS_BY_REASON[result.reason] || 403;
  return res.status(status).json({
    error: result.reason,
  });
}

function requireChapterAccess(accessService, options = {}) {
  if (!accessService || typeof accessService.canReadChapter !== "function") {
    throw new Error("requireChapterAccess requires accessService.canReadChapter");
  }

  const getChapterId =
    options.getChapterId || ((req) => req.params.chapterId || req.params.id);
  const getUserId =
    options.getUserId || ((req) => req.user && (req.user.id || req.user._id));

  return async function chapterAccessMiddleware(req, res, next) {
    try {
      const chapterId = getChapterId(req);
      const userId = getUserId(req);
      const result = await accessService.canReadChapter(userId, chapterId);

      res.locals = res.locals || {};
      res.locals.chapterAccess = result;

      if (!result.allowed) {
        return sendAccessError(res, result);
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  requireChapterAccess,
  sendAccessError,
};
