import "dotenv/config";
import { z } from "zod";

const booleanFromString = z
  .string()
  .optional()
  .transform((value) => value !== "false");

const numberFromString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : defaultValue))
    .pipe(z.number().finite().nonnegative());

const optionalNumberFromString = z
  .string()
  .optional()
  .transform((value) => (value ? Number(value) : undefined))
  .pipe(z.number().finite().nonnegative().optional());

const optionalStringFromString = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

const EnvSchema = z.object({
  TRUYENDICH_BASE_URL: z.string().url().default("https://truyendich.live"),
  STORY_URL: z.string().url().optional(),
  START_CHAPTER: optionalNumberFromString,
  END_CHAPTER: optionalNumberFromString,
  CHAPTERS_PER_FILE: numberFromString(50).pipe(z.number().int().positive()),
  CHAPTERS_PER_BROWSER: numberFromString(5).pipe(z.number().int().positive()),
  CLEAR_SESSION_AFTER_BROWSER: booleanFromString.default("false"),
  HEADFUL: booleanFromString.default("true"),
  DELAY_MIN_SECONDS: numberFromString(5),
  DELAY_MAX_SECONDS: numberFromString(9),
  BREAK_AFTER_CHAPTERS: numberFromString(50),
  BREAK_MIN_SECONDS: numberFromString(180),
  BREAK_MAX_SECONDS: numberFromString(300),
  CORRUPTED_GLYPH_RETRIES: numberFromString(3).pipe(z.number().int().nonnegative()),
  CORRUPTED_GLYPH_COOLDOWN_SECONDS: numberFromString(90).pipe(z.number().int().nonnegative()),
  CHALLENGE_WAIT_SECONDS: numberFromString(60).pipe(z.number().int().nonnegative()),
  CHALLENGE_POLL_SECONDS: numberFromString(5).pipe(z.number().int().positive()),
  MANUAL_CHALLENGE_SECONDS: numberFromString(0).pipe(z.number().int().nonnegative()),
  CHALLENGE_BROWSER_RETRIES: numberFromString(1).pipe(z.number().int().nonnegative()),
  CHALLENGE_BROWSER_COOLDOWN_SECONDS: numberFromString(30).pipe(z.number().int().nonnegative()),
  PERSISTENT_BROWSER_PROFILE: booleanFromString.default("true"),
  BLOCK_HEAVY_RESOURCES: booleanFromString.default("false"),
  BROWSER_CHANNEL: optionalStringFromString,
  DEBUG_FULL_PAGE_SCREENSHOTS: booleanFromString.default("false"),
  NAVIGATION_TIMEOUT_MS: numberFromString(30000)
});

export const env = EnvSchema.parse(process.env);
