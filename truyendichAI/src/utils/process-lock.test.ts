import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireProcessLock } from "./process-lock.js";

const tempDirs: string[] = [];

async function createLockPath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "truyendich-lock-"));
  tempDirs.push(directory);
  return path.join(directory, "crawler.lock");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("acquireProcessLock", () => {
  it("prevents a second live crawler instance", async () => {
    const lockPath = await createLockPath();
    const release = await acquireProcessLock(lockPath);

    await expect(acquireProcessLock(lockPath)).rejects.toThrow(`PID ${process.pid}`);
    await release();
  });

  it("replaces a stale lock and can be acquired again after release", async () => {
    const lockPath = await createLockPath();
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999_999_999, startedAt: new Date(0).toISOString() }));

    const firstRelease = await acquireProcessLock(lockPath);
    await firstRelease();
    const secondRelease = await acquireProcessLock(lockPath);
    await secondRelease();

    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
