import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { randomDelaySeconds } from "../utils/delay.js";

export class RateLimiter {
  private completedSinceBreak = 0;

  async afterChapter(): Promise<void> {
    this.completedSinceBreak += 1;
    if (this.completedSinceBreak >= env.BREAK_AFTER_CHAPTERS) {
      this.completedSinceBreak = 0;
      logger.info({ min: env.BREAK_MIN_SECONDS, max: env.BREAK_MAX_SECONDS }, "Taking long break");
      const seconds = await randomDelaySeconds(env.BREAK_MIN_SECONDS, env.BREAK_MAX_SECONDS);
      logger.info({ seconds }, "Long break finished");
      return;
    }
    logger.info({ min: env.DELAY_MIN_SECONDS, max: env.DELAY_MAX_SECONDS }, "Waiting before next chapter");
    const seconds = await randomDelaySeconds(env.DELAY_MIN_SECONDS, env.DELAY_MAX_SECONDS);
    logger.info({ seconds }, "Wait finished");
  }
}
