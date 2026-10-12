import { CRAWLER_LOCK_PATH } from "./config/constants.js";
import { logger } from "./logging/logger.js";
import { runCli } from "./cli/commands.js";
import { acquireProcessLock } from "./utils/process-lock.js";

const command = process.argv[2];
const needsCrawlerLock = command !== "status" && command !== "retry-failed";
const releaseLock = needsCrawlerLock ? await acquireProcessLock(CRAWLER_LOCK_PATH) : async () => undefined;
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Crawler stopping");
  await releaseLock();
  process.exit(0);
}

process.on("unhandledRejection", async (reason) => {
  logger.error(reason instanceof Error ? { err: reason } : { reason }, "Unhandled rejection");
  await releaseLock();
  process.exit(1);
});

process.on("uncaughtException", async (error) => {
  logger.error({ err: error }, "Uncaught exception");
  await releaseLock();
  process.exit(1);
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await runCli();
} finally {
  await releaseLock();
}
