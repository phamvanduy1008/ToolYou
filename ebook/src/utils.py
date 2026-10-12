from __future__ import annotations

import re
import unicodedata
from pathlib import Path

FOLD_TRANSLATION = str.maketrans({"đ": "d", "Đ": "D"})
INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
RESERVED_WINDOWS = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}

CATEGORY_INFO = {
    "tien-hiep": ("488", "Tiên Hiệp"),
    "huyen-ao": ("497", "Huyền Ảo"),
    "ngon-tinh": ("487", "Ngôn Tình"),
    "tieu-thuyet": ("490", "Tiểu Thuyết"),
    "trom-mo": ("506", "Trộm Mộ"),
    "tu-duy": ("1452", "Tư Duy"),
    "hai-huoc": ("523", "Hài Hước"),
    "trong-sinh": ("507", "Trọng Sinh"),
    "do-thi-quan-truong": ("495", "Đô Thị – Quan Trường"),
    "sac-3s-h-18": ("489", "Sắc – H – 18+"),
    "mat-the": ("2562", "Mạt Thế"),
    "dam-my": ("494", "Đam Mỹ"),
    "kinh-di": ("491", "Kinh Dị"),
    "di-nang": ("496", "Dị Năng"),
    "kiem-hiep-vo-hiep": ("526", "Kiếm Hiệp – Võ Hiệp"),
    "ky-nang-song-khoi-nghiep": ("500", "Kỹ Năng Sống – Khởi Nghiệp"),
    "quan-tri-kinh-doanh": ("499", "Quản Trị – Kinh Doanh"),
    "bach-hop": ("510", "Bách Hợp"),
    "lich-su-quan-su": ("501", "Dã Sử – Quân Sự"),
    "vo-han-luu": ("545", "Vô Hạn Lưu"),
    "khoa-huyen": ("524", "Khoa Huyễn"),
    "xuyen-khong": ("498", "Xuyên Không"),
    "thieu-nhi": ("505", "Thiếu Nhi"),
    "audio-book": ("2447", "Sách Nói – Audiobook"),
    "truyen-tranh": ("7742", "Truyện Tranh – Manga – Comic"),
}
CATEGORY_FOLDERS = {slug: label for slug, (_category_id, label) in CATEGORY_INFO.items()}
TRANSLATION_FOLDERS = {
    "HUMAN": "Dịch",
    "AI": "AI",
    "CONVERT": "CV",
    "MIXED": "Chưa xác định",
    "UNKNOWN": "Chưa xác định",
}


def compact(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text or "").split())


def fold(text: str) -> str:
    normalized = unicodedata.normalize("NFD", compact(text).translate(FOLD_TRANSLATION))
    return "".join(char for char in normalized if unicodedata.category(char) != "Mn").casefold()


def is_completed(status: str, allow_cv_full: bool = False) -> bool:
    accepted = {"hoan thanh"}
    if allow_cv_full:
        accepted.add("cv full")
    return fold(status) in accepted


def sanitize_filename(value: str, max_length: int = 160) -> str:
    name = INVALID_FILENAME.sub(" ", compact(value)).rstrip(" .")
    name = " ".join(name.split())[:max_length].rstrip(" .") or "Không rõ tên"
    if name.split(".")[0].upper() in RESERVED_WINDOWS:
        name = f"_{name}"
    return name


def book_path(root: Path, translation_type: str, title: str, author: str) -> Path:
    stem = title if not author else f"{title} - {author}"
    return root / TRANSLATION_FOLDERS.get(translation_type, "Chưa xác định") / f"{sanitize_filename(stem)}.epub"
