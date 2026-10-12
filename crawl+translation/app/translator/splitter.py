import re


def _hard_split(text: str, maximum: int) -> list[str]:
    return [text[index:index + maximum] for index in range(0, len(text), maximum)]


def _split_paragraph(paragraph: str, maximum: int) -> list[str]:
    sentences = [part for part in re.split(r"(?<=[。！？；])", paragraph) if part]
    output: list[str] = []
    current = ""
    for sentence in sentences:
        for piece in _hard_split(sentence, maximum):
            if current and len(current) + len(piece) > maximum:
                output.append(current); current = ""
            current += piece
    if current:
        output.append(current)
    return output


def split_text(text: str, max_chars: int) -> list[str]:
    """Split text without losing characters, preferring paragraph boundaries."""
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    if not text:
        return []
    paragraphs = re.split(r"(?<=\n)", text)
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        pieces = [paragraph] if len(paragraph) <= max_chars else _split_paragraph(paragraph, max_chars)
        for piece in pieces:
            if current and len(current) + len(piece) > max_chars:
                chunks.append(current); current = ""
            current += piece
    if current:
        chunks.append(current)
    return chunks

