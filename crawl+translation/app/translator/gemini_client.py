import logging
import re
import threading
import time

from google import genai
from google.genai import types
from tenacity import before_sleep_log, retry, retry_if_exception, stop_after_attempt

from app.config import SETTINGS


class GeminiFatalError(RuntimeError):
    pass


class GeminiDailyQuotaError(GeminiFatalError):
    """Raised when the project's per-model daily request quota is exhausted."""


class GeminiRecitationError(RuntimeError):
    """Raised when Gemini refuses a response because it detects recitation."""


class GeminiContentBlockedError(RuntimeError):
    """Raised when Gemini explicitly blocks the prompt or response content."""


def _is_daily_quota_error(exc: BaseException) -> bool:
    compact = re.sub(r"[^a-z0-9]", "", str(exc).lower())
    return (
        "requestsperday" in compact
        or "generaterequestsperdayperprojectpermodel" in compact
        or "dailyquota" in compact
    )


def _is_retryable(exc: BaseException) -> bool:
    # Cancellation signals must immediately reach the CLI. Retrying Ctrl+C
    # makes an already slow API call look as if the process ignored the user.
    if not isinstance(exc, Exception):
        return False
    if isinstance(
        exc, (GeminiFatalError, GeminiRecitationError, GeminiContentBlockedError)
    ):
        return False
    if _is_daily_quota_error(exc):
        return False
    message = str(exc).lower()
    fatal = (
        "api key", "unauthenticated", "permission_denied", "not found",
        "invalid argument", "safety", "perday",
    )
    return not any(token in message for token in fatal)


def _retry_delay(exc: BaseException | None, attempt_number: int) -> float:
    """Honor the API's retry delay for per-minute quota responses."""
    message = str(exc or "")
    match = re.search(r"retry(?: in|Delay[^0-9]*)\s*([0-9]+(?:\.[0-9]+)?)s", message, re.I)
    if match:
        return min(float(match.group(1)) + 1.0, 120.0)
    return min(float(2 ** attempt_number), 60.0)


def _wait_for_retry(retry_state) -> float:
    exception = retry_state.outcome.exception() if retry_state.outcome else None
    return _retry_delay(exception, retry_state.attempt_number)


def _empty_response_details(response: object) -> str:
    """Extract useful diagnostics without assuming every SDK field exists."""
    details: list[str] = []
    prompt_feedback = getattr(response, "prompt_feedback", None)
    if prompt_feedback:
        details.append(f"prompt_feedback={prompt_feedback}")
    candidates = getattr(response, "candidates", None) or []
    for position, candidate in enumerate(candidates, 1):
        finish_reason = getattr(candidate, "finish_reason", None)
        safety_ratings = getattr(candidate, "safety_ratings", None)
        if finish_reason:
            details.append(f"candidate_{position}_finish_reason={finish_reason}")
        if safety_ratings:
            details.append(f"candidate_{position}_safety={safety_ratings}")
    return "; ".join(details) or "no candidate diagnostics"


class _RateLimiter:
    """Space request starts evenly so a burst cannot consume the RPM quota."""

    def __init__(self, requests_per_minute: float, *, clock=time.monotonic,
                 sleep=time.sleep) -> None:
        self.interval = 60.0 / requests_per_minute
        self._clock = clock
        self._sleep = sleep
        self._last_request_at: float | None = None
        self._lock = threading.Lock()

    def wait(self) -> None:
        # Keep the lock while sleeping so this remains safe if translation is
        # made concurrent later.
        with self._lock:
            now = self._clock()
            if self._last_request_at is not None:
                delay = self.interval - (now - self._last_request_at)
                if delay > 0:
                    logging.info(
                        "[GEMINI] RPM limiter waiting %.2fs before next request",
                        delay,
                    )
                    self._sleep(delay)
                    now = self._clock()
            self._last_request_at = now


class GeminiClient:
    def __init__(self) -> None:
        if not SETTINGS.gemini_api_key:
            raise GeminiFatalError("GEMINI_API_KEY is missing; set it in .env")
        self.model = SETTINGS.gemini_model
        self.client = genai.Client(
            api_key=SETTINGS.gemini_api_key,
            http_options=types.HttpOptions(
                timeout=SETTINGS.gemini_request_timeout * 1000,
            ),
        )
        self.rate_limiter = _RateLimiter(SETTINGS.gemini_requests_per_minute)

    @retry(
        stop=stop_after_attempt(5),
        wait=_wait_for_retry,
        retry=retry_if_exception(_is_retryable),
        before_sleep=before_sleep_log(logging.getLogger(__name__), logging.WARNING),
        reraise=True,
    )
    def translate(self, prompt: str, model: str | None = None) -> str:
        # This runs again on every Tenacity attempt, so retries are throttled too.
        self.rate_limiter.wait()
        try:
            response = self.client.models.generate_content(
                model=model or self.model, contents=prompt
            )
        except Exception as exc:
            if _is_daily_quota_error(exc):
                raise GeminiDailyQuotaError(str(exc)) from exc
            raise
        text = (response.text or "").strip()
        if not text:
            details = _empty_response_details(response)
            if "recitation" in details.lower():
                raise GeminiRecitationError(
                    "Gemini blocked the response as recitation: " + details
                )
            if "prohibited_content" in details.lower():
                raise GeminiContentBlockedError(
                    "Gemini blocked the response as prohibited content: " + details
                )
            # A successful HTTP response can occasionally contain no text.
            # Treat this as transient so tenacity retries the same chunk.
            raise RuntimeError(
                "Gemini returned an empty response: " + details
            )
        return text

