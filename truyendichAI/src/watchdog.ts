import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import "dotenv/config";
import { PROGRESS_PATH } from "./config/constants.js";
import { logger } from "./logging/logger.js";

interface ProgressSnapshot {
  changedAtMs: number;
  completed: number;
  lastCompletedChapter?: number;
}

const checkSeconds = Number(process.env.WATCHDOG_CHECK_SECONDS ?? 30);
const stallSeconds = Number(process.env.WATCHDOG_STALL_SECONDS ?? 180);
const restartDelaySeconds = Number(process.env.WATCHDOG_RESTART_DELAY_SECONDS ?? 10);
const restartOnExit = process.env.WATCHDOG_RESTART_ON_EXIT === "true";
const restartOnError = process.env.WATCHDOG_RESTART_ON_ERROR !== "false";
const restartOnBlocked = process.env.WATCHDOG_RESTART_ON_BLOCKED !== "false";
const blockedCooldownSeconds = Number(process.env.WATCHDOG_BLOCKED_COOLDOWN_SECONDS ?? 900);
const gracefulStopSeconds = Number(process.env.WATCHDOG_GRACEFUL_STOP_SECONDS ?? 15);

let child: ChildProcess | undefined;
let lastSnapshot: ProgressSnapshot | undefined;
let lastProgressAtMs = Date.now();
let expectedWaitUntilMs = 0;
let scheduledRestartAtMs = 0;
let lastStatusLogAtMs = 0;
let lastFailure: "blocked" | "error" | undefined;
let stopping = false;
const intentionalStops = new WeakSet<ChildProcess>();

async function readSnapshot(): Promise<ProgressSnapshot | undefined> {
  try {
    const stat = await fs.stat(PROGRESS_PATH);
    const raw = await fs.readFile(PROGRESS_PATH, "utf8");
    const progress = JSON.parse(raw.replace(/^\uFEFF/, "")) as {
      chapters?: Record<string, { status?: string }>;
      lastRun?: { lastCompletedChapter?: number };
    };
    const completed = Object.values(progress.chapters ?? {}).filter((chapter) => chapter.status === "completed").length;
    return {
      changedAtMs: stat.mtimeMs,
      completed,
      lastCompletedChapter: progress.lastRun?.lastCompletedChapter
    };
  } catch {
    return undefined;
  }
}

function didProgressChange(previous: ProgressSnapshot | undefined, next: ProgressSnapshot | undefined): boolean {
  if (!next) return false;
  if (!previous) return true;
  return (
    next.completed !== previous.completed ||
    next.lastCompletedChapter !== previous.lastCompletedChapter
  );
}

function handleCrawlerLogLine(line: string): void {
  process.stdout.write(`${line}\n`);

  try {
    const event = JSON.parse(line) as {
      level?: number;
      msg?: string;
      max?: number;
      waitSeconds?: number;
      cooldownSeconds?: number;
    };
    if ((event.level ?? 0) >= 50) {
      const lower = line.toLowerCase();
      lastFailure =
        lower.includes("nonretryableerror") ||
        lower.includes("website blocked") ||
        lower.includes("captcha/challenge") ||
        lower.includes("forbidden")
          ? "blocked"
          : "error";
    }
    if (event.msg === "Chapter security verification detected; waiting" && typeof event.waitSeconds === "number") {
      expectedWaitUntilMs = Date.now() + (event.waitSeconds + 60) * 1000;
    }
    if ((event.msg === "Waiting before next chapter" || event.msg === "Taking long break") && typeof event.max === "number") {
      expectedWaitUntilMs = Date.now() + (event.max + 60) * 1000;
    }
    if (
      event.msg === "Corrupted glyph content detected; cooling down before retrying chapter" &&
      typeof event.cooldownSeconds === "number"
    ) {
      expectedWaitUntilMs = Date.now() + (event.cooldownSeconds + 60) * 1000;
    }
    if (
      event.msg === "Wait finished" ||
      event.msg === "Long break finished" ||
      event.msg === "Chapter security verification cleared" ||
      event.msg === "Chapter security verification did not clear"
    ) {
      expectedWaitUntilMs = 0;
    }
  } catch {
    // Non-JSON npm banner output is still echoed above.
  }
}

function pipeCrawlerOutput(stream: NodeJS.ReadableStream | null): void {
  if (!stream) return;
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) handleCrawlerLogLine(line);
    }
  });
  stream.on("end", () => {
    if (buffer.trim()) handleCrawlerLogLine(buffer);
  });
}

function startCrawler(): void {
  const entryPath = path.join(process.cwd(), "src", "index.ts");
  lastFailure = undefined;
  expectedWaitUntilMs = 0;
  scheduledRestartAtMs = 0;
  child = spawn(process.execPath, ["--import", "tsx", entryPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const startedChild = child;

  logger.info({ pid: startedChild.pid }, "Started crawler");
  pipeCrawlerOutput(startedChild.stdout);
  pipeCrawlerOutput(startedChild.stderr);

  startedChild.on("exit", (code, signal) => {
    logger.warn({ code, signal, lastFailure }, "Crawler exited");
    if (child === startedChild) {
      child = undefined;
    }
    if (stopping || intentionalStops.has(startedChild)) return;

    if (lastFailure === "blocked" && restartOnBlocked) {
      scheduledRestartAtMs = Date.now() + blockedCooldownSeconds * 1000;
      logger.warn({ seconds: blockedCooldownSeconds }, "Crawler blocked; cooling down before restart");
      return;
    }

    if (lastFailure === "error" && restartOnError) {
      const delaySeconds = Math.max(restartDelaySeconds, 60);
      scheduledRestartAtMs = Date.now() + delaySeconds * 1000;
      logger.warn({ seconds: delaySeconds }, "Crawler failed; waiting before restart");
    } else if (restartOnExit) {
      scheduledRestartAtMs = Date.now() + restartDelaySeconds * 1000;
      logger.warn({ seconds: restartDelaySeconds }, "Crawler stopped; waiting before restart");
    }
  });
}

async function forceKillProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }

  child?.kill("SIGKILL");
}

async function stopCrawler(): Promise<void> {
  const runningChild = child;
  if (!runningChild?.pid) return;
  const pid = runningChild.pid;
  intentionalStops.add(runningChild);
  logger.warn({ pid }, "Stopping crawler before restart");

  if (process.platform === "win32") {
    await forceKillProcessTree(pid);
  } else {
    runningChild.kill("SIGTERM");
  }
  const deadline = Date.now() + gracefulStopSeconds * 1000;
  while (child === runningChild && Date.now() < deadline) {
    await sleep(500);
  }

  if (child === runningChild) {
    logger.warn({ pid, seconds: gracefulStopSeconds }, "Crawler did not stop gracefully; forcing stop");
    await forceKillProcessTree(pid);
  }
}

async function restartCrawler(reason: string): Promise<void> {
  logger.warn({ reason }, "Restarting stalled crawler");
  await stopCrawler();
  await sleep(restartDelaySeconds * 1000);
  lastSnapshot = await readSnapshot();
  lastProgressAtMs = Date.now();
  lastStatusLogAtMs = 0;
  startCrawler();
}

async function monitor(): Promise<void> {
  startCrawler();
  lastSnapshot = await readSnapshot();
  lastProgressAtMs = Date.now();

  while (!stopping) {
    await sleep(checkSeconds * 1000);
    if (!child) {
      if (scheduledRestartAtMs > 0 && Date.now() >= scheduledRestartAtMs) {
        lastSnapshot = await readSnapshot();
        lastProgressAtMs = Date.now();
        startCrawler();
      }
      continue;
    }

    const snapshot = await readSnapshot();
    if (didProgressChange(lastSnapshot, snapshot)) {
      lastSnapshot = snapshot;
      lastProgressAtMs = Date.now();
      lastStatusLogAtMs = 0;
      logger.info(snapshot, "Crawler progress changed");
      continue;
    }

    const idleSeconds = Math.floor((Date.now() - lastProgressAtMs) / 1000);
    if (Date.now() < expectedWaitUntilMs) {
      continue;
    }

    if (idleSeconds >= stallSeconds) {
      await restartCrawler(`no completed chapter for ${idleSeconds}s`);
      continue;
    }

    if (Date.now() - lastStatusLogAtMs >= 60_000) {
      lastStatusLogAtMs = Date.now();
      logger.info({ idleSeconds, stallSeconds }, "Crawler progress unchanged");
    }
  }
}

process.on("SIGINT", async () => {
  stopping = true;
  await stopCrawler();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  stopping = true;
  await stopCrawler();
  process.exit(0);
});

await monitor();
