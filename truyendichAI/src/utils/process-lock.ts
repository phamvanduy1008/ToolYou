import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

interface LockContents {
  pid: number;
  startedAt: string;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLock(lockPath: string): Promise<LockContents | undefined> {
  try {
    return JSON.parse(await fs.readFile(lockPath, "utf8")) as LockContents;
  } catch {
    return undefined;
  }
}

export async function acquireProcessLock(lockPath: string): Promise<() => Promise<void>> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  let handle: FileHandle | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      const existing = await readLock(lockPath);
      if (existing && isProcessAlive(existing.pid)) {
        throw new Error(`Crawler is already running (PID ${existing.pid}). Stop it before starting another instance.`);
      }

      await fs.rm(lockPath, { force: true });
    }
  }

  if (!handle) throw new Error("Could not acquire crawler process lock");

  await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle?.close().catch(() => undefined);
    const existing = await readLock(lockPath);
    if (existing?.pid === process.pid) {
      await fs.rm(lockPath, { force: true });
    }
  };
}
