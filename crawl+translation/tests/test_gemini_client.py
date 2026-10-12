import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.translator.gemini_client import (
    GeminiClient, GeminiContentBlockedError, GeminiDailyQuotaError, GeminiRecitationError,
    _RateLimiter, _empty_response_details, _is_daily_quota_error,
    _is_retryable, _retry_delay,
)


class GeminiClientTests(unittest.TestCase):
    def test_empty_response_is_retryable(self):
        self.assertTrue(_is_retryable(RuntimeError("Gemini returned an empty response")))

    def test_keyboard_interrupt_is_never_retried(self):
        self.assertFalse(_is_retryable(KeyboardInterrupt()))

    def test_client_configures_request_timeout_in_milliseconds(self):
        settings = SimpleNamespace(
            gemini_api_key="test-key",
            gemini_model="fast-model",
            gemini_requests_per_minute=12,
            gemini_request_timeout=300,
        )
        with (
            patch("app.translator.gemini_client.SETTINGS", settings),
            patch("app.translator.gemini_client.genai.Client") as constructor,
        ):
            GeminiClient()

        http_options = constructor.call_args.kwargs["http_options"]
        self.assertEqual(http_options.timeout, 300_000)

    def test_safety_error_is_not_retryable(self):
        self.assertFalse(_is_retryable(RuntimeError("request blocked by safety policy")))

    def test_recitation_is_not_retried_with_identical_prompt(self):
        self.assertFalse(_is_retryable(GeminiRecitationError("recitation")))

    def test_content_block_is_not_retried_with_identical_prompt(self):
        self.assertFalse(
            _is_retryable(GeminiContentBlockedError("PROHIBITED_CONTENT"))
        )

    def test_per_minute_quota_is_retryable(self):
        error = RuntimeError(
            "generate_content_free_tier_requests; Please retry in 32.413688202s."
        )
        self.assertTrue(_is_retryable(error))
        self.assertAlmostEqual(_retry_delay(error, 1), 33.413688202)

    def test_daily_quota_is_not_retryable(self):
        self.assertFalse(_is_retryable(RuntimeError("quota limit is PerDay")))

    def test_real_daily_quota_id_is_not_retryable(self):
        error = RuntimeError(
            "quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier; "
            "Please retry in 12h13m33s"
        )
        self.assertTrue(_is_daily_quota_error(error))
        self.assertFalse(_is_retryable(error))
        self.assertFalse(_is_retryable(GeminiDailyQuotaError(str(error))))

    def test_empty_response_diagnostics(self):
        response = SimpleNamespace(
            prompt_feedback="not blocked",
            candidates=[SimpleNamespace(finish_reason="MAX_TOKENS", safety_ratings=[])],
        )
        details = _empty_response_details(response)
        self.assertIn("prompt_feedback=not blocked", details)
        self.assertIn("finish_reason=MAX_TOKENS", details)

    def test_rate_limiter_evenly_spaces_requests(self):
        current = [100.0]
        sleeps = []

        def clock():
            return current[0]

        def sleep(seconds):
            sleeps.append(seconds)
            current[0] += seconds

        limiter = _RateLimiter(12, clock=clock, sleep=sleep)
        limiter.wait()
        limiter.wait()
        current[0] += 2.0
        limiter.wait()

        self.assertEqual(sleeps, [5.0, 3.0])


if __name__ == "__main__":
    unittest.main()
