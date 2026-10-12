import { sleep } from "./delay.js";

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export async function retry<T>(task: (attempt: number) => Promise<T>, delaysMs: number[]): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (error instanceof NonRetryableError) break;
      const delayMs = delaysMs[attempt];
      if (delayMs === undefined) break;
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
