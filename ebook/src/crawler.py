from __future__ import annotations

import random
import time
from collections.abc import Callable
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests

from .parser import pagination_pages, parse_category
from .utils import CATEGORY_INFO

BASE_URL = "https://dtv-ebook.com.vn"
USER_AGENT = "DTV-EPUB-Collector/0.1 (personal EPUB catalog; respectful rate limit)"
RETRY_STATUSES = {429, 500, 502, 503, 504}


class Crawler:
    def __init__(self, *, delay_min: float = 1.5, delay_max: float = 3.0) -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self.delay_min = delay_min
        self.delay_max = delay_max
        self._last_request = 0.0
        self.on_progress: Callable[[str], None] | None = None
        self.robots = RobotFileParser()
        self.robots.set_url(f"{BASE_URL}/robots.txt")
        response = self.session.get(self.robots.url, timeout=20)
        response.raise_for_status()
        self._last_request = time.monotonic()
        self.robots.parse(response.text.splitlines())

    def get(self, url: str) -> requests.Response:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "dtv-ebook.com.vn":
            raise ValueError(f"URL ngoài phạm vi DTV: {url}")
        if not self.robots.can_fetch(USER_AGENT, url):
            raise PermissionError(f"robots.txt không cho phép: {url}")
        for attempt in range(5):
            remaining = self._last_request + random.uniform(self.delay_min, self.delay_max) - time.monotonic()
            if remaining > 0:
                time.sleep(remaining)
            self._last_request = time.monotonic()
            try:
                response = self.session.get(url, timeout=25, allow_redirects=True)
            except (requests.Timeout, requests.ConnectionError) as exc:
                if attempt == 4:
                    raise
                if self.on_progress:
                    self.on_progress(f"[RETRY] {type(exc).__name__}: thử lại {attempt + 2}/5 sau {2 ** (attempt + 1)} giây: {url}")
            else:
                if response.status_code not in RETRY_STATUSES:
                    response.raise_for_status() if response.status_code != 404 else None
                    if urlparse(response.url).hostname != "dtv-ebook.com.vn" or not self.robots.can_fetch(USER_AGENT, response.url):
                        raise PermissionError(f"Redirect nằm ngoài phạm vi được phép: {response.url}")
                    response.encoding = response.apparent_encoding or "utf-8"
                    return response
                if attempt == 4:
                    response.raise_for_status()
                if self.on_progress:
                    self.on_progress(f"[RETRY] HTTP {response.status_code}: thử lại {attempt + 2}/5 sau {2 ** (attempt + 1)} giây: {url}")
            time.sleep(2 ** (attempt + 1))
        raise RuntimeError("Hết lượt thử request")

    def category_pages(self, slug: str, *, max_pages: int | None = None):
        if slug not in CATEGORY_INFO:
            raise ValueError(f"Danh mục không hợp lệ: {slug}")
        category_id = CATEGORY_INFO[slug][0]
        base = f"{BASE_URL}/{slug}-{category_id}"
        seen_ids: set[str] = set()
        page = 1
        highest_linked = 1
        while max_pages is None or page <= max_pages:
            url = f"{base}.html" if page == 1 else f"{base}/{page}.html"
            if self.on_progress:
                self.on_progress(f"[PAGE] Đang mở trang {page}: {url}")
            response = self.get(url)
            if response.status_code == 404:
                return
            if "Chưa có dữ liệu" in response.text:
                return
            items = parse_category(response.text, url)
            if not items:
                return
            fresh = [item for item in items if item[1] not in seen_ids]
            if not fresh:
                return
            seen_ids.update(item[1] for item in fresh)
            highest_linked = max(highest_linked, *pagination_pages(response.text, f"{slug}-{category_id}"))
            yield page, fresh
            if page >= highest_linked and highest_linked > 1:
                return
            page += 1
