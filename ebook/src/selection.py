"""Choose one downloadable version per work before starting downloads."""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Callable, Iterable

from .models import Book
from .utils import fold

PRIORITY = {
    "HUMAN": 5,
    "MIXED": 4,
    "AI": 3,
    "CONVERT": 2,
    "UNKNOWN": 1,
}

VERSION_SUFFIX = re.compile(
    r"\s*[([]\s*(?:ban\s+)?(?:ai\s+dich|dich\s+ai|cv(?:\s+full)?|convert|ban\s+dich)\s*[)\]]\s*$"
)


def title_key(title: str) -> str:
    return VERSION_SUFFIX.sub("", fold(title)).strip()


def select_preferred(
    books: Iterable[Book], valid_download: Callable[[Book], bool] | None = None
) -> tuple[list[Book], dict[str, str]]:
    """Return winners and a mapping of lower-priority IDs to winner IDs.

    Same-title books with distinct known authors remain separate works. A missing
    author joins a title only when there is at most one known author for it.
    """
    ordered = list(books)
    by_title: dict[str, list[Book]] = defaultdict(list)
    for book in ordered:
        by_title[title_key(book.title)].append(book)

    groups: list[list[Book]] = []
    for title_books in by_title.values():
        authors = {fold(book.author) for book in title_books if book.author}
        if len(authors) <= 1:
            groups.append(title_books)
        else:
            by_author: dict[str, list[Book]] = defaultdict(list)
            for book in title_books:
                by_author[fold(book.author) if book.author else f"unknown:{book.id}"].append(book)
            groups.extend(by_author.values())

    position = {book.id: index for index, book in enumerate(ordered)}
    winners: list[Book] = []
    lower_priority: dict[str, str] = {}
    for group in groups:
        winner = max(
            group,
            key=lambda book: (
                PRIORITY.get(book.translation_type, 0),
                book.translation_type == "AI" and book.ai_edited,
                bool(valid_download(book)) if valid_download else False,
                -position[book.id],
            ),
        )
        winners.append(winner)
        for book in group:
            if book.id != winner.id:
                lower_priority[book.id] = winner.id
    winners.sort(key=lambda book: position[book.id])
    return winners, lower_priority
