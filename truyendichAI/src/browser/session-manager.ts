import fs from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { BROWSER_STATE_PATH } from "../config/constants.js";

export async function storageStateExists(): Promise<boolean> {
  try {
    await fs.access(BROWSER_STATE_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function saveStorageState(context: BrowserContext): Promise<void> {
  await context.storageState({ path: BROWSER_STATE_PATH });
}

export async function clearStorageState(): Promise<void> {
  try {
    await fs.unlink(BROWSER_STATE_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
