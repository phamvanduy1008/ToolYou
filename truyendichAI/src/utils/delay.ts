export function randomInt(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function randomDelaySeconds(min: number, max: number): Promise<number> {
  const seconds = randomInt(min, max);
  await sleep(seconds * 1000);
  return seconds;
}
