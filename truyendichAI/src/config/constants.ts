import path from "node:path";

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const OUTPUT_DIR = path.join(ROOT_DIR, "output");
export const SCREENSHOT_DIR = path.join(ROOT_DIR, "screenshots");
export const DEBUG_DIR = path.join(ROOT_DIR, "debug");
export const LOG_DIR = path.join(ROOT_DIR, "logs");
export const BROWSER_PROFILE_DIR = path.join(DATA_DIR, "browser-profile");
export const BROWSER_STATE_PATH = path.join(DATA_DIR, "browser-state.json");
export const PROGRESS_PATH = path.join(DATA_DIR, "progress.json");
export const CRAWLER_LOCK_PATH = path.join(DATA_DIR, "crawler.lock");

export const BLOCKED_STATUS_CODES = new Set([401, 403, 429]);
export const RETRYABLE_STATUS_CODES = new Set([503, 520, 521, 522]);
