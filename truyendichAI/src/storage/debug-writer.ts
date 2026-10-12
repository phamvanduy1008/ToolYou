import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { DEBUG_DIR, SCREENSHOT_DIR } from "../config/constants.js";
import { env } from "../config/env.js";
import { safeSegment } from "./filename.js";

export async function writeScreenshot(name: string, page: Page): Promise<string> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOT_DIR, `${safeSegment(name)}-${Date.now()}.png`);
  await page.screenshot({ path: filePath, fullPage: env.DEBUG_FULL_PAGE_SCREENSHOTS });
  return filePath;
}

export async function writeDebugHtml(name: string, html: string): Promise<string> {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  const filePath = path.join(DEBUG_DIR, `${safeSegment(name)}-${Date.now()}.html`);
  await fs.writeFile(filePath, html, "utf8");
  return filePath;
}
