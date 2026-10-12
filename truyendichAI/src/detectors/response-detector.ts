import type { Response } from "playwright";
import { BLOCKED_STATUS_CODES, RETRYABLE_STATUS_CODES } from "../config/constants.js";

export type ResponseState = "ok" | "blocked" | "retryable";

export function classifyResponse(response: Response | null): ResponseState {
  if (!response) return "retryable";
  const status = response.status();
  if (BLOCKED_STATUS_CODES.has(status)) return "blocked";
  if (RETRYABLE_STATUS_CODES.has(status)) return "retryable";
  return "ok";
}
