import type { Page } from "playwright";
import { classifyResponse } from "../detectors/response-detector.js";
import { validateChapter } from "../detectors/content-validator.js";
import { env } from "../config/env.js";
import { parseChapter } from "../parsers/chapter-parser.js";
import { writeChapterFile } from "../storage/file-writer.js";
import { upsertChapterProgress } from "../storage/progress-store.js";
import { writeDebugHtml } from "../storage/debug-writer.js";
import type { ChapterLink, ParsedChapter, StoryMetadata } from "../types/index.js";
import { NonRetryableError, retry } from "../utils/retry.js";
import { sleep } from "../utils/delay.js";
import { logger } from "../logging/logger.js";

interface CrawlChapterOptions {
  writeIndividualFile?: boolean;
}

interface ValidatedChapter {
  chapter: ParsedChapter;
  html: string;
}

function isChallengeReason(reason: string): boolean {
  return reason.includes("challenge");
}

function isSecurityVerificationReason(reason: string): boolean {
  return isChallengeReason(reason) || reason.includes("anti-bot glyphs");
}

function isForbiddenUrl(url: string): boolean {
  return /\/forbidden(?:[/?#]|$)/i.test(url);
}

async function waitForChallengeToClear(page: Page, link: ChapterLink): Promise<ValidatedChapter | undefined> {
  const autoDeadline = Date.now() + env.CHALLENGE_WAIT_SECONDS * 1000;
  const startedAt = Date.now();
  if (env.CHALLENGE_WAIT_SECONDS > 0) {
    logger.warn(
      { chapter: link.number, waitSeconds: env.CHALLENGE_WAIT_SECONDS, pollSeconds: env.CHALLENGE_POLL_SECONDS },
      "Chapter security verification detected; waiting"
    );
    await upsertChapterProgress({
      number: link.number,
      title: link.title,
      url: link.url,
      status: "challenge",
      retryCount: 0,
      errorMessage: `Waiting up to ${env.CHALLENGE_WAIT_SECONDS}s for security verification`,
      updatedAt: new Date().toISOString()
    });
  }

  while (Date.now() < autoDeadline) {
    const remainingSeconds = Math.max(1, Math.ceil((autoDeadline - Date.now()) / 1000));
    await sleep(Math.min(env.CHALLENGE_POLL_SECONDS, remainingSeconds) * 1000);
    const html = await page.content();
    const chapter = parseChapter(html, page.url(), link.number);
    const validation = validateChapter(chapter.title, chapter.content, html);
    if (validation.ok) {
      logger.info({ chapter: link.number, waitedSeconds: Math.ceil((Date.now() - startedAt) / 1000) }, "Chapter security verification cleared");
      return { chapter, html };
    }
    if (!isSecurityVerificationReason(validation.reason ?? "")) return undefined;
  }

  if (env.CHALLENGE_WAIT_SECONDS > 0) {
    logger.warn(
      { chapter: link.number, waitedSeconds: Math.ceil((Date.now() - startedAt) / 1000) },
      "Chapter security verification did not clear"
    );
  }

  const manualDeadline = Date.now() + env.MANUAL_CHALLENGE_SECONDS * 1000;
  if (env.MANUAL_CHALLENGE_SECONDS > 0) {
    logger.warn(
      { chapter: link.number, waitSeconds: env.MANUAL_CHALLENGE_SECONDS },
      "Manual security verification required"
    );
    await upsertChapterProgress({
      number: link.number,
      title: link.title,
      url: link.url,
      status: "challenge",
      retryCount: 0,
      errorMessage: `Waiting up to ${env.MANUAL_CHALLENGE_SECONDS}s for manual security verification`,
      updatedAt: new Date().toISOString()
    });
  }
  while (env.MANUAL_CHALLENGE_SECONDS > 0 && Date.now() < manualDeadline) {
    const remainingSeconds = Math.max(1, Math.ceil((manualDeadline - Date.now()) / 1000));
    await sleep(Math.min(5, remainingSeconds) * 1000);
    const html = await page.content();
    const chapter = parseChapter(html, page.url(), link.number);
    const validation = validateChapter(chapter.title, chapter.content, html);
    if (validation.ok) {
      logger.info({ chapter: link.number }, "Manual security verification cleared");
      return { chapter, html };
    }
    if (!isSecurityVerificationReason(validation.reason ?? "")) return undefined;
  }

  return undefined;
}

export async function crawlChapter(
  page: Page,
  story: StoryMetadata,
  link: ChapterLink,
  options: CrawlChapterOptions = {}
): Promise<ParsedChapter> {
  await upsertChapterProgress({
    number: link.number,
    title: link.title,
    url: link.url,
    status: "processing",
    retryCount: 0,
    updatedAt: new Date().toISOString()
  });

  return retry(async (attempt) => {
    const response = await page.goto(link.url, { waitUntil: "domcontentloaded" });
    const state = classifyResponse(response);
    let html = await page.content();

    if (state === "blocked" || isForbiddenUrl(page.url())) {
      const debugHtmlPath = await writeDebugHtml(`blocked-${link.number}`, html);
      await upsertChapterProgress({
        number: link.number,
        title: link.title,
        url: link.url,
        status: "blocked",
        retryCount: attempt,
        errorMessage: `Forbidden/blocked response. Debug HTML: ${debugHtmlPath}`,
        updatedAt: new Date().toISOString()
      });
      throw new NonRetryableError(`Forbidden page while crawling chapter ${link.number}`);
    }
    if (state === "retryable") {
      throw new Error(`Retryable response while crawling chapter ${link.number}: ${response?.status() ?? "no response"}`);
    }

    let chapter = parseChapter(html, page.url(), link.number);
    let validation = validateChapter(chapter.title, chapter.content, html);
    const reason = validation.reason ?? "Invalid chapter content";
    if (!validation.ok && isSecurityVerificationReason(reason)) {
      const recovered = await waitForChallengeToClear(page, link);
      if (recovered) {
        html = recovered.html;
        chapter = recovered.chapter;
        validation = validateChapter(chapter.title, chapter.content, html);
      }
    }

    if (!validation.ok) {
      const reason = validation.reason ?? "Invalid chapter content";
      const isChallenge = isChallengeReason(reason);
      const debugHtmlPath = await writeDebugHtml(`${isChallenge ? "challenge" : "invalid"}-${link.number}`, html);
      await upsertChapterProgress({
        number: link.number,
        title: link.title,
        url: link.url,
        status: isChallenge ? "challenge" : "failed",
        retryCount: attempt,
        errorMessage: `${reason}. Debug HTML: ${debugHtmlPath}`,
        updatedAt: new Date().toISOString()
      });
      if (isChallenge) throw new NonRetryableError(reason);
      if (reason.includes("anti-bot glyphs")) throw new NonRetryableError(reason);
      throw new Error(reason);
    }

    if (options.writeIndividualFile !== false) {
      const filePath = await writeChapterFile(story, chapter);
      await upsertChapterProgress({
        number: chapter.number,
        title: chapter.title,
        url: chapter.url,
        status: "completed",
        filePath,
        contentLength: chapter.content.length,
        retryCount: attempt,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
    }

    return chapter;
  }, [15000, 60000]);
}
