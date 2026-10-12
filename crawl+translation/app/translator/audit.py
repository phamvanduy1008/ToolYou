from pathlib import Path

from app.config import (
    DATA_DIR, LOG_DIR, current_book_directories,
    versioned_translation_directory,
)
from app.storage.json_store import validate_vietnamese_translation
from app.translator.glossary import load_glossary


def _selected(index: int, start: int | None, end: int | None,
              chapters: set[int] | None) -> bool:
    return (
        (chapters is None or index in chapters)
        and (start is None or index >= start)
        and (end is None or index <= end)
    )


def audit_translations(start: int | None = None, end: int | None = None,
                       chapters: set[int] | None = None,
                       report_path: Path | None = None,
                       version: str | None = None) -> int:
    """Audit numeric chapter files and write a human-readable report."""
    raw_dir, _ = current_book_directories()
    translated_dir = versioned_translation_directory(version)
    glossary = load_glossary(DATA_DIR / "glossary.json")
    files = sorted(
        (
            path for path in translated_dir.glob("*.txt")
            if path.stem.isdigit()
            and _selected(int(path.stem), start, end, chapters)
        ),
        key=lambda path: int(path.stem),
    )
    lines: list[str] = []
    present = {int(path.stem) for path in files}
    expected: set[int] = set()
    if chapters is not None:
        expected = {
            index for index in chapters
            if _selected(index, start, end, chapters)
        }
    elif start is not None or end is not None:
        expected = {
            int(path.stem)
            for path in raw_dir.glob("*.txt")
            if path.stem.isdigit()
            and _selected(int(path.stem), start, end, None)
        }
    missing = sorted(expected - present)
    failed = len(missing)
    warnings = 0
    for index in missing:
        lines.append(f"CHƯƠNG {index}: LỖI")
        lines.append(f"  - không tìm thấy file bản dịch: {index}.txt")
        lines.append("")

    for path in files:
        index = int(path.stem)
        translated = path.read_text(encoding="utf-8")
        raw_path = raw_dir / path.name
        chapter_warnings: list[str] = []
        if raw_path.exists():
            source = raw_path.read_text(encoding="utf-8")
            errors = validate_vietnamese_translation(
                translated, glossary=glossary, source_text=source
            )
            for source_name, target_name in glossary.items():
                if source_name in source and target_name not in translated:
                    chapter_warnings.append(
                        f"raw có {source_name} nhưng bản dịch không có {target_name}"
                    )
        else:
            errors = validate_vietnamese_translation(
                translated, glossary=glossary
            )
            chapter_warnings.append("không tìm thấy raw tương ứng")

        if errors:
            failed += 1
            lines.append(f"CHƯƠNG {index}: LỖI")
            lines.extend(f"  - {error}" for error in errors)
        if chapter_warnings:
            warnings += 1
            if not errors:
                lines.append(f"CHƯƠNG {index}: CẢNH BÁO")
            lines.extend(f"  - {warning}" for warning in chapter_warnings[:20])
        if errors or chapter_warnings:
            lines.append("")

    summary = (
        f"Đã kiểm tra: {len(files)} chương\n"
        f"Thiếu bản dịch: {len(missing)} chương\n"
        f"Có lỗi chắc chắn: {failed} chương\n"
        f"Có cảnh báo tên: {warnings} chương\n"
    )
    report = summary + ("\n" + "\n".join(lines) if lines else "\nKhông phát hiện lỗi.")
    target = report_path or (LOG_DIR / "translation_audit.txt")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(report.rstrip() + "\n", encoding="utf-8")
    print(summary.rstrip())
    print(f"Báo cáo: {target}")
    return 1 if failed else 0
