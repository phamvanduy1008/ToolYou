import logging
import random
import time
from dataclasses import dataclass
from urllib.robotparser import RobotFileParser
from urllib.parse import urlsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.config import SETTINGS

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/154.0.0.0 Safari/537.36")


class AccessDeniedError(RuntimeError):
    pass


@dataclass(frozen=True)
class FetchResult:
    text: str
    final_url: str
    content_type: str
    status_code: int


class HttpClient:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        retries = Retry(total=4, connect=4, read=4, status=4, backoff_factor=2,
                        status_forcelist=(429, 500, 502, 503, 504),
                        allowed_methods=frozenset({"GET"}), respect_retry_after_header=True)
        self.session.mount("https://", HTTPAdapter(max_retries=retries))
        self.session.mount("http://", HTTPAdapter(max_retries=retries))
        self._last_request = 0.0
        self._robots: dict[str, RobotFileParser] = {}

    def _allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        root = f"{parts.scheme}://{parts.netloc}"
        if root not in self._robots:
            robots_url = root + "/robots.txt"
            parser = RobotFileParser(robots_url)
            try:
                # Use the crawler session: urllib's default request can receive a
                # different response and incorrectly set disallow_all.
                response = self.session.get(robots_url, timeout=SETTINGS.request_timeout)
                if response.status_code in (401, 403):
                    raise AccessDeniedError(
                        f"Cannot access robots.txt (HTTP {response.status_code}); refusing to crawl"
                    )
                response.raise_for_status()
                parser.parse(response.text.splitlines())
            except requests.RequestException as exc:
                raise AccessDeniedError(
                    f"Cannot verify robots.txt; refusing to crawl: {exc}"
                ) from exc
            self._robots[root] = parser
        return self._robots[root].can_fetch(USER_AGENT, url)

    def get_response(self, url: str) -> FetchResult:
        if not self._allowed(url):
            raise AccessDeniedError(f"robots.txt disallows crawling: {url}")
        elapsed = time.monotonic() - self._last_request
        delay = random.uniform(SETTINGS.request_delay_min, SETTINGS.request_delay_max)
        if elapsed < delay:
            time.sleep(delay - elapsed)
        response = self.session.get(url, timeout=SETTINGS.request_timeout)
        self._last_request = time.monotonic()
        if response.status_code in (401, 403):
            raise AccessDeniedError(f"HTTP {response.status_code}; access denied, not bypassing")
        response.raise_for_status()
        if not response.encoding or response.encoding.lower() in {"iso-8859-1", "ascii"}:
            response.encoding = response.apparent_encoding
        return FetchResult(
            text=response.text,
            final_url=response.url,
            content_type=response.headers.get("Content-Type", ""),
            status_code=response.status_code,
        )

    def get(self, url: str) -> str:
        return self.get_response(url).text

