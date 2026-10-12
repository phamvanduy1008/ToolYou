from dataclasses import dataclass
from pathlib import Path
import os
import re
import json
import unicodedata

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
TRANSLATED_DIR = DATA_DIR / "translated"
LOG_DIR = ROOT / "logs"


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str
    gemini_model: str
    gemini_repair_model: str
    gemini_requests_per_minute: float
    gemini_request_timeout: int
    translation_workers: int
    request_delay_min: float
    request_delay_max: float
    request_timeout: int
    max_translate_chars: int
    qt_reference_dir: str
    qt_reference_max_names: int
    qt_reference_max_terms: int
    book_url: str
    crawl_start: int
    crawl_count: int


def load_settings() -> Settings:
    """Load application settings once from .env and the environment."""
    load_dotenv(ROOT / ".env")
    settings = Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip(),
        gemini_repair_model=os.getenv("GEMINI_REPAIR_MODEL", "gemini-3.5-flash").strip(),
        gemini_requests_per_minute=float(
            os.getenv("GEMINI_REQUESTS_PER_MINUTE", "12")
        ),
        gemini_request_timeout=int(os.getenv("GEMINI_REQUEST_TIMEOUT", "300")),
        translation_workers=int(os.getenv("TRANSLATION_WORKERS", "2")),
        request_delay_min=float(os.getenv("REQUEST_DELAY_MIN", "1.5")),
        request_delay_max=float(os.getenv("REQUEST_DELAY_MAX", "3.0")),
        request_timeout=int(os.getenv("REQUEST_TIMEOUT", "20")),
        max_translate_chars=int(os.getenv("MAX_TRANSLATE_CHARS", "6000")),
        qt_reference_dir=os.getenv("QT_REFERENCE_DIR", "").strip(),
        qt_reference_max_names=int(os.getenv("QT_REFERENCE_MAX_NAMES", "20")),
        qt_reference_max_terms=int(os.getenv("QT_REFERENCE_MAX_TERMS", "40")),
        book_url=os.getenv("BOOK_URL", "").strip(),
        crawl_start=int(os.getenv("CRAWL_START", "1")),
        crawl_count=int(os.getenv("CRAWL_COUNT", "3")),
    )
    if settings.request_delay_min < 0 or settings.request_delay_max < settings.request_delay_min:
        raise ValueError("REQUEST_DELAY_MIN/MAX are invalid")
    if settings.gemini_requests_per_minute <= 0:
        raise ValueError("GEMINI_REQUESTS_PER_MINUTE must be greater than zero")
    if settings.gemini_request_timeout <= 0:
        raise ValueError("GEMINI_REQUEST_TIMEOUT must be greater than zero")
    if settings.translation_workers < 1 or settings.translation_workers > 8:
        raise ValueError("TRANSLATION_WORKERS must be between 1 and 8")
    if settings.max_translate_chars < 100:
        raise ValueError("MAX_TRANSLATE_CHARS must be at least 100")
    if settings.qt_reference_max_names < 0 or settings.qt_reference_max_terms < 0:
        raise ValueError("QT_REFERENCE_MAX_NAMES/TERMS cannot be negative")
    if settings.crawl_start < 1 or settings.crawl_count < 1:
        raise ValueError("CRAWL_START and CRAWL_COUNT must be positive")
    return settings


SETTINGS = load_settings()


def ensure_directories() -> None:
    for path in (DATA_DIR, RAW_DIR, TRANSLATED_DIR, LOG_DIR):
        path.mkdir(parents=True, exist_ok=True)


def safe_book_name(title: str) -> str:
    """Return a Windows-safe, accent-free, underscore-separated folder name."""
    normalized = unicodedata.normalize("NFD", title.replace("Đ", "D").replace("đ", "d"))
    name = "".join(character for character in normalized
                   if unicodedata.category(character) != "Mn")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip().rstrip(".")
    name = re.sub(r"\s+", "_", name)
    return name or "unknown_book"


def current_book_directories() -> tuple[Path, Path]:
    """Return raw/translated directories for the active book metadata."""
    try:
        metadata = json.loads((DATA_DIR / "book.json").read_text(encoding="utf-8"))
        title = str(metadata.get("title_vi") or metadata.get("title_cn") or "unknown_book")
    except (OSError, ValueError, TypeError):
        title = "unknown_book"
    folder = safe_book_name(title)
    return RAW_DIR / folder, TRANSLATED_DIR / folder


def versioned_translation_directory(version: str | None = None) -> Path:
    """Return an isolated translation directory for a named pipeline version."""
    _, default = current_book_directories()
    if not version:
        return default
    normalized = safe_book_name(version)
    if normalized != version or not re.fullmatch(r"[A-Za-z0-9_-]+", version):
        raise ValueError("Translation version must contain only letters, numbers, _ or -")
    return default.parent / f"{default.name}_{version}"

