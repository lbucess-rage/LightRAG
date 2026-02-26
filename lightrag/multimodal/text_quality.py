"""
Text quality detection utilities for multimodal processing.

Detects garbled CJK text that occurs when PDF parsers misinterpret
wide-spaced Hangul characters as CJK ideographs (e.g., "合引出早大" instead of "비상레버위치").
"""

from lightrag.utils import logger


def _is_cjk_ideograph(ch: str) -> bool:
    """Check if character is a CJK Unified Ideograph (Chinese/Japanese Kanji)."""
    cp = ord(ch)
    return (
        (0x4E00 <= cp <= 0x9FFF)       # CJK Unified Ideographs
        or (0x3400 <= cp <= 0x4DBF)    # CJK Unified Ideographs Extension A
        or (0xF900 <= cp <= 0xFAFF)    # CJK Compatibility Ideographs
    )


def _is_hangul(ch: str) -> bool:
    """Check if character is Korean Hangul."""
    cp = ord(ch)
    return (
        (0xAC00 <= cp <= 0xD7AF)       # Hangul Syllables
        or (0x1100 <= cp <= 0x11FF)    # Hangul Jamo
        or (0x3130 <= cp <= 0x318F)    # Hangul Compatibility Jamo
    )


def extract_table_cell_text(table_body: str) -> str:
    """Extract only cell text content from a markdown table, stripping structure.

    Removes markdown table formatting characters (|, -, :) and extracts
    the actual cell values so CJK ratio is not diluted by ASCII structure.

    Args:
        table_body: Markdown table string (e.g., "| NO | 合引出早大 |\\n|---|---|")

    Returns:
        Concatenated cell text with spaces between cells
    """
    if not table_body:
        return ""

    cell_texts = []
    for line in table_body.split("\n"):
        line = line.strip()
        # Skip separator rows (e.g., "|------|------|")
        if line and all(c in "|-: " for c in line):
            continue
        # Split by pipe and extract cell content
        if "|" in line:
            cells = line.split("|")
            for cell in cells:
                cell = cell.strip()
                if cell:
                    cell_texts.append(cell)

    return " ".join(cell_texts)


def is_garbled_cjk(
    text: str,
    expected_language: str = "Korean",
    cjk_ratio_threshold: float = 0.3,
    min_cjk_chars: int = 5,
) -> bool:
    """Detect garbled CJK text in Korean documents.

    When PDF parsers extract wide-spaced Hangul text, they sometimes produce
    CJK ideographs instead of Hangul syllables. This function detects such cases
    by checking if the text has an unusually high ratio of CJK ideographs
    with very few actual Hangul characters.

    Args:
        text: Text to check
        expected_language: Expected document language (only "Korean" triggers detection)
        cjk_ratio_threshold: Minimum CJK ideograph ratio to flag as garbled
        min_cjk_chars: Minimum CJK ideograph count to flag (avoids false positives on short text)

    Returns:
        True if the text appears to be garbled CJK (misrecognized Korean)
    """
    if expected_language != "Korean":
        return False

    if not text or len(text.strip()) < 10:
        return False

    cjk_count = 0
    hangul_count = 0
    total_chars = 0

    for ch in text:
        if ch.isspace():
            continue
        total_chars += 1
        if _is_cjk_ideograph(ch):
            cjk_count += 1
        elif _is_hangul(ch):
            hangul_count += 1

    if total_chars == 0 or cjk_count < min_cjk_chars:
        return False

    cjk_ratio = cjk_count / total_chars
    hangul_ratio = hangul_count / total_chars if total_chars > 0 else 0

    is_garbled = cjk_ratio >= cjk_ratio_threshold and hangul_ratio < 0.1

    if is_garbled:
        logger.debug(
            f"Garbled CJK detected: cjk_ratio={cjk_ratio:.2f}, "
            f"hangul_ratio={hangul_ratio:.2f}, "
            f"cjk_count={cjk_count}, total={total_chars}, "
            f"sample='{text[:50]}...'"
        )

    return is_garbled
