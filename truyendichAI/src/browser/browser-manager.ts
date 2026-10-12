import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BROWSER_PROFILE_DIR, BROWSER_STATE_PATH } from "../config/constants.js";
import { env } from "../config/env.js";
import { storageStateExists } from "./session-manager.js";
import { installResourceBlocker } from "./resource-blocker.js";

export interface BrowserHandle {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function createBrowserHandle(headful = env.HEADFUL): Promise<BrowserHandle> {
  const args = ["--disable-session-crashed-bubble", "--hide-crash-restore-bubble", "--no-first-run", "--disable-infobars"];
  if (env.PERSISTENT_BROWSER_PROFILE) {
    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
      headless: !headful,
      channel: env.BROWSER_CHANNEL,
      args,
      viewport: null
    });
    context.setDefaultTimeout(env.NAVIGATION_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(env.NAVIGATION_TIMEOUT_MS);
    if (env.BLOCK_HEAVY_RESOURCES) {
      await installResourceBlocker(context);
    }
    const page = context.pages()[0] ?? (await context.newPage());
    return {
      browser: context.browser() ?? undefined,
      context,
      page,
      close: async () => {
        await context.close();
      }
    };
  }

  const browser = await chromium.launch({ headless: !headful, channel: env.BROWSER_CHANNEL, args });
  const context = await browser.newContext({
    storageState: (await storageStateExists()) ? BROWSER_STATE_PATH : undefined
  });
  context.setDefaultTimeout(env.NAVIGATION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(env.NAVIGATION_TIMEOUT_MS);
  if (env.BLOCK_HEAVY_RESOURCES) {
    await installResourceBlocker(context);
  }
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close();
      await browser.close();
    }
  };
}
