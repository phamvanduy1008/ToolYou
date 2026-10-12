import logging

from app.config import LOG_DIR, ensure_directories


def configure_logging() -> None:
    ensure_directories()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8"),
            logging.StreamHandler(),
        ],
        force=True,
    )

