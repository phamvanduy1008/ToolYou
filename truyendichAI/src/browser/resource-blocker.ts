import type { BrowserContext } from "playwright";

const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

export async function installResourceBlocker(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}
