import re
from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import BeautifulSoup

from app.models import Chapter


def _same_book_path(url: str, base_url: str) -> bool:
    link, base = urlsplit(url), urlsplit(base_url)
    bqgns_match = re.fullmatch(r"/book/(\d+)/?", base.path)
    if bqgns_match:
        return (
            link.netloc == base.netloc
            and re.fullmatch(
                rf"/book/{re.escape(bqgns_match.group(1))}/\d+/?",
                link.path,
            ) is not None
        )
    book_match = re.search(r"/(?:xiaoshuo|zhangjie)/(\d+)(?:/|$)", base.path)
    if book_match:
        return (
            link.netloc == base.netloc
            and re.fullmatch(
                rf"/zhangjie/{re.escape(book_match.group(1))}/\d+\.html",
                link.path,
            ) is not None
        )
    book_path = base.path.rstrip("/") + "/"
    return link.netloc == base.netloc and link.path.startswith(book_path)


def parse_catalogue_url(html: str, page_url: str) -> str:
    """Return a catalogue URL when the input is a supported chapter URL."""
    path = urlsplit(page_url).path
    if not re.fullmatch(r"/zhangjie/\d+/\d+\.html", path):
        return page_url

    soup = BeautifulSoup(html, "lxml")
    node = soup.select_one("#pb_mulu[href], a[href*='/xiaoshuo/']")
    if node is None:
        raise ValueError(f"Cannot find the catalogue link on chapter page: {page_url}")
    catalogue_url = urljoin(page_url, node.get("href", ""))
    if urlsplit(catalogue_url).netloc != urlsplit(page_url).netloc:
        raise ValueError(f"Catalogue link points to another domain: {catalogue_url}")
    return catalogue_url


def parse_book_page(html: str, base_url: str) -> list[Chapter]:
    """Parse supported-site chapter links in display order from a catalogue."""
    soup = BeautifulSoup(html, "lxml")
    result: list[Chapter] = []
    seen: set[str] = set()
    positions: dict[str, int] = {}
    # 97du places the canonical chapter catalogue in listmain. Avoid the
    # separate "latest 12" block because it is reverse chronological.
    anchors = soup.select(
        ".border_chapter .fen_4 a[href], .book_list2 a[href], "
        ".listmain dd a[href], .listmain li a[href], #chapter-list a[href]"
    )
    if not anchors:
        anchors = soup.select("a[href]")
    for anchor in anchors:
        url = urljoin(base_url, anchor.get("href", ""))
        path = urlsplit(url).path
        if not _same_book_path(url, base_url) or not re.search(
            r"/\d+(?:\.html)?/?$", path
        ):
            continue
        title = anchor.get_text(" ", strip=True)
        if not title:
            continue
        if url in seen:
            # Bqgns links "Start reading" to chapter 1 before listing the
            # same URL with its real numbered title. Keep the useful label.
            position = positions[url]
            if (
                re.match(r"^第\s*\d+\s*章", title)
                and not re.match(r"^第\s*\d+\s*章", result[position].title)
            ):
                result[position] = Chapter(position + 1, title, url)
            continue
        seen.add(url)
        positions[url] = len(result)
        result.append(Chapter(len(result) + 1, title, url))
    if not result:
        raise ValueError("No chapter links found; the supported site structure may have changed")
    return result


def parse_pagination_urls(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    urls: list[str] = []
    pattern = re.compile(r"index_(\d+)\.html$")
    base = urlsplit(base_url)
    for anchor in soup.select("a[href]"):
        url = urljoin(base_url, anchor.get("href", ""))
        parts = urlsplit(url)
        is_index_page = pattern.search(parts.path) is not None
        is_query_page = (
            parts.netloc == base.netloc
            and parts.path.rstrip("/") == base.path.rstrip("/")
            and parse_qs(parts.query).get("page", [""])[0].isdigit()
        )
        if (is_index_page or is_query_page) and url not in urls:
            urls.append(url)

    def page_number(value: str) -> int:
        parts = urlsplit(value)
        match = pattern.search(parts.path)
        return int(match.group(1)) if match else int(parse_qs(parts.query)["page"][0])

    return sorted(urls, key=page_number)


def parse_chapter_page(html: str, url: str) -> tuple[str, str]:
    """Extract and clean a chapter title and body from supported sites."""
    soup = BeautifulSoup(html, "lxml")
    host = urlsplit(url).netloc.lower()
    if host.endswith("bqgns.com"):
        title_node = soup.select_one("h1.text_tit")
        content_node = soup.select_one("div.text")
    else:
        title_node = soup.select_one("h1")
        content_node = soup.select_one(
            "article.font_max, #txt, #content, .content, .chapter-content, .read-content"
        )
    if title_node is None or content_node is None:
        raise ValueError(f"Chapter title/content selector failed: {url}")
    for node in content_node.select("script, style, noscript, iframe"):
        node.decompose()
    if urlsplit(url).netloc.lower().endswith("biquge321.com"):
        # Biquge321 prepends a promotional link to every chapter body.
        for node in content_node.select("a"):
            node.decompose()
    title = title_node.get_text(" ", strip=True)
    text = content_node.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"第\s*[（(]\s*\d+\s*/\s*\d+\s*[）)]\s*页", "", text)
    if urlsplit(url).netloc.lower().endswith("biquge321.com"):
        text = re.sub(r"一秒记住【笔趣阁】[^\n]*", "", text)
        text = re.sub(r"第\s*\d+\s*章[^\n]*?[（(]第\d+/\d+页[）)]", "", text)
        text = text.replace("（本章未完，请点击下一页继续阅读）", "\n")
    # Some 97du pages append a bare pagination digit directly after the final
    # punctuation of a paragraph (for example: `。”4`). It is navigation
    # debris, not story content, and otherwise triggers false number-mismatch
    # failures during translation validation.
    text = re.sub(r"(?<=[。！？!?…”’」』])[1-9]\d{0,2}(?=\n|$)", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not title or len(text) <= 100:
        raise ValueError(f"Chapter content is missing or too short: {url}")
    return title, text


def parse_chapter_page_count(html: str) -> int:
    """Return the advertised number of sub-pages for a 97du chapter."""
    soup = BeautifulSoup(html, "lxml")
    content_node = soup.select_one("article.font_max")
    if content_node is None:
        return 1
    match = re.search(r"第\s*[（(]\s*\d+\s*/\s*(\d+)\s*[）)]\s*页", content_node.get_text(" ", strip=True))
    return int(match.group(1)) if match else 1

