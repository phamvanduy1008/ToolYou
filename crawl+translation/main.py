import argparse
import sys
from pathlib import Path

from app.config import DATA_DIR, SETTINGS, current_book_directories, ensure_directories
from app.logging_config import configure_logging
from app.storage.json_store import read_json, valid_chapter_text, valid_translation_text


def status() -> None:
    from app.translator.glossary import load_glossary

    book = read_json(DATA_DIR / "book.json")
    raw_dir, translated_dir = current_book_directories()
    glossary = load_glossary(DATA_DIR / "glossary.json")
    raw = sum(valid_chapter_text(path) for path in raw_dir.glob("*.txt"))
    translated = sum(
        valid_translation_text(path, glossary)
        for path in translated_dir.glob("*.txt")
    )
    total = int(book.get("chapter_count") or raw)
    print(f"Book chapters detected: {total}\nRaw downloaded: {raw}\nTranslated: {translated}\n"
          f"Raw missing: {max(0, total - raw)}\nTranslation pending: {max(0, raw - translated)}")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Crawl and translate Chinese novels")
    commands = root.add_subparsers(dest="command", required=True)
    crawl = commands.add_parser("crawl"); crawl.add_argument("--url")
    crawl.add_argument(
        "--book",
        help="Use safe crawl config/snapshot for this book key, e.g. Thai_Hu_Chi_Ton",
    )
    crawl.add_argument(
        "--staging", action="store_true",
        help="Validate and retain chapters in staging; use crawl-commit after audit",
    )
    crawl.add_argument(
        "--continue-on-error", action="store_true",
        help="Continue the safe crawl after a failed or quarantined chapter",
    )
    translate = commands.add_parser("translate")
    translate.add_argument(
        "--chapters",
        help="Comma-separated chapter numbers/ranges, e.g. 4,8,10-12",
    )
    translate.add_argument("--version", help="Write to a separate versioned directory, e.g. v2")
    translate.add_argument(
        "--book",
        help="Raw book folder name, e.g. Thai_Hu_Chi_Ton (auto-detected when unambiguous)",
    )
    translate.add_argument(
        "--continue-on-error", action="store_true",
        help="Keep translating later chapters and report all failures at the end",
    )
    translate.add_argument(
        "--skip-glossary-discovery", action="store_true",
        help="Skip the extra per-chapter name-discovery request when glossary is ready",
    )
    audit = commands.add_parser("audit")
    audit.add_argument(
        "--chapters",
        help="Comma-separated chapter numbers/ranges, e.g. 4,8,10-12",
    )
    audit.add_argument("--start", type=int)
    audit.add_argument("--end", type=int)
    audit.add_argument(
        "--output", type=Path, default=DATA_DIR.parent / "logs" / "translation_audit.txt"
    )
    audit.add_argument("--version", help="Audit a versioned translation directory")
    glossary_build = commands.add_parser("glossary-build")
    glossary_build.add_argument("--start", type=int)
    glossary_build.add_argument("--end", type=int)
    glossary_build.add_argument("--batch-chars", type=int, default=30000)
    glossary_apply = commands.add_parser("glossary-apply")
    glossary_apply.add_argument("--approve-unambiguous", action="store_true")
    crawl_catalogue = commands.add_parser("crawl-catalogue")
    crawl_catalogue.add_argument("--book", required=True)
    crawl_catalogue.add_argument("--url")
    crawl_audit = commands.add_parser("crawl-audit")
    crawl_audit.add_argument("--book", required=True)
    crawl_audit.add_argument("--start", type=int)
    crawl_audit.add_argument("--end", type=int)
    crawl_audit.add_argument("--reference", choices=("qidian", "manifest"))
    crawl_audit.add_argument(
        "--output", type=Path,
        help="Markdown report path (defaults to logs/crawl_audit_<book>.md)",
    )
    crawl_commit = commands.add_parser("crawl-commit")
    crawl_commit.add_argument("--book", required=True)
    crawl_commit.add_argument("--start", type=int)
    crawl_commit.add_argument("--end", type=int)
    for command in (crawl, translate):
        command.add_argument("--start", type=int); command.add_argument("--end", type=int)
        command.add_argument("--force", action="store_true")
    export = commands.add_parser("export"); export.add_argument("--format", choices=("txt",), default="txt")
    export.add_argument("--output", type=Path, default=Path("output/book_vi.txt"))
    export.add_argument("--allow-missing", action="store_true")
    export.add_argument("--version", help="Export a versioned translation directory")
    commands.add_parser("status")
    return root


def parse_chapter_spec(value: str | None) -> set[int] | None:
    if not value:
        return None
    result: set[int] = set()
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        if "-" in item:
            left, right = item.split("-", 1)
            start, end = int(left), int(right)
            if start < 1 or end < start:
                raise ValueError(f"Invalid chapter range: {item}")
            result.update(range(start, end + 1))
        else:
            number = int(item)
            if number < 1:
                raise ValueError(f"Invalid chapter number: {item}")
            result.add(number)
    if not result:
        raise ValueError("--chapters cannot be empty")
    return result


def main() -> int:
    # Windows may inherit a legacy console code page that cannot print Chinese.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ensure_directories(); configure_logging()
    cli_parser = parser()
    args = cli_parser.parse_args()
    if hasattr(args, "start") and args.start and args.end and args.start > args.end:
        cli_parser.error("--start cannot be greater than --end")
    if (
        args.command in {"translate", "audit"}
        and args.chapters
        and (args.start is not None or args.end is not None)
    ):
        cli_parser.error(
            "--chapters cannot be combined with --start/--end; "
            "use --chapters 1279-1301 or --start 1279 --end 1301"
        )
    try:
        if args.command == "crawl":
            start = args.start if args.start is not None else SETTINGS.crawl_start
            end = args.end if args.end is not None else start + SETTINGS.crawl_count - 1
            if args.book:
                from app.crawler.safe_crawler import crawl_from_snapshot
                if args.url:
                    from app.crawler.safety import load_book_spec
                    expected = str(load_book_spec(args.book)["primary_catalogue_url"])
                    if args.url.rstrip("/") != expected.rstrip("/"):
                        raise ValueError(f"--url does not match configured source: {expected}")
                crawl_from_snapshot(
                    args.book, start, end, args.force,
                    args.staging, args.continue_on_error,
                )
            else:
                from app.crawler.crawler import crawl_book
                book = read_json(DATA_DIR / "book.json")
                url = args.url or SETTINGS.book_url or book.get("source_url")
                if not url: raise ValueError("Provide --url or set source_url in data/book.json")
                crawl_book(url, start, end, args.force)
        elif args.command == "crawl-catalogue":
            from app.crawler.safe_crawler import crawl_catalogue
            crawl_catalogue(args.book, args.url)
        elif args.command == "crawl-audit":
            from app.crawler.safe_crawler import audit_crawl
            return audit_crawl(
                args.book, args.start, args.end, args.output, args.reference,
            )
        elif args.command == "crawl-commit":
            from app.crawler.safe_crawler import commit_staged
            commit_staged(args.book, args.start, args.end)
        elif args.command == "translate":
            from app.translator.translator import translate_chapters
            translate_chapters(
                args.start, args.end, args.force,
                parse_chapter_spec(args.chapters), args.version,
                args.continue_on_error, args.book,
                not args.skip_glossary_discovery,
            )
        elif args.command == "audit":
            from app.translator.audit import audit_translations
            return audit_translations(
                args.start, args.end, parse_chapter_spec(args.chapters),
                args.output, args.version,
            )
        elif args.command == "glossary-build":
            from app.translator.glossary_builder import build_glossary_candidates
            build_glossary_candidates(args.start, args.end, args.batch_chars)
        elif args.command == "glossary-apply":
            from app.translator.glossary_builder import apply_glossary_candidates
            apply_glossary_candidates(args.approve_unambiguous)
        elif args.command == "export":
            from app.storage.exporter import export_txt
            export_txt(args.output, args.allow_missing, args.version)
        else: status()
        return 0
    except (ValueError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr); return 1


if __name__ == "__main__":
    raise SystemExit(main())

