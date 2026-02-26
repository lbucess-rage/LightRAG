"""Citation post-processing utilities for RAG responses.

Validates and normalizes inline [n] citation tags in LLM output.
"""

import re
from typing import Dict, List, Set, Tuple


def get_valid_reference_ids(references: list) -> Set[str]:
    """Extract the set of valid reference_id values from a references list."""
    ids: Set[str] = set()
    for ref in references:
        rid = ref.get("reference_id", "")
        if rid:
            ids.add(str(rid))
    return ids


def strip_references_section(text: str) -> str:
    """Remove a trailing References section from the response text.

    Handles variants like:
      ### References
      ## References
      # Reference
      **References**
    """
    # Markdown heading variants
    text = re.sub(
        r"\n#{1,3}\s*References?\s*\n[\s\S]*$", "", text, flags=re.IGNORECASE
    )
    # Bold variant: **References**
    text = re.sub(
        r"\n\*{2}References?\*{2}\s*\n[\s\S]*$", "", text, flags=re.IGNORECASE
    )
    return text.rstrip()


def parse_evidence_map(text: str) -> Tuple[str, Dict[str, List[str]]]:
    """Extract and remove an evidence map block from the response text.

    Legacy support: if the LLM happens to produce an evidence map block,
    strip it from the response and parse it.  For new code, prefer
    `extract_evidence_from_chunks()` which requires no LLM cooperation.

    Returns:
        (cleaned_text, evidence_dict)
    """
    evidence: Dict[str, List[str]] = {}

    pattern = re.compile(r"\s*<!--EVIDENCE_MAP\s*\n(.*?)-->\s*", re.DOTALL)
    match = pattern.search(text)
    if not match:
        return text, evidence

    block = match.group(1)
    line_pattern = re.compile(r'\[(\d{1,3})\]\s*"([^"]+)"')
    for m in line_pattern.finditer(block):
        ref_id = m.group(1)
        snippet = m.group(2).strip()
        if snippet:
            evidence.setdefault(ref_id, []).append(snippet)

    cleaned = text[: match.start()] + text[match.end() :]
    return cleaned.rstrip(), evidence


def attach_evidence_to_references(
    references: list, evidence: Dict[str, List[str]]
) -> None:
    """Attach evidence snippets to matching reference items in-place."""
    for ref in references:
        ref_id = str(ref.get("reference_id", ""))
        if ref_id in evidence:
            ref["evidence"] = evidence[ref_id]


# ---------------------------------------------------------------------------
# Backend-side evidence extraction (no LLM cooperation needed)
# ---------------------------------------------------------------------------

def _extract_cited_sentences(response_text: str) -> Dict[str, List[str]]:
    """Extract sentences surrounding each [n] citation from the LLM response.

    Returns:
        Dict mapping reference_id -> list of citing sentences (cleaned of tags).
    """
    cited: Dict[str, List[str]] = {}

    # Split into sentence-like segments (period / newline boundaries)
    # Keep citation tags attached to the preceding clause.
    segments = re.split(r'(?<=[.!?。\n])\s+', response_text)

    for seg in segments:
        # Find all [n] tags in this segment
        for m in re.finditer(r'\[(\d{1,3})\]', seg):
            ref_id = m.group(1)
            # Clean the segment: remove all [n] tags and markdown formatting
            clean = re.sub(r'\[\d{1,3}\]', '', seg).strip()
            clean = re.sub(r'[*#>`\-]+', '', clean).strip()
            if len(clean) >= 8:  # skip too-short fragments
                cited.setdefault(ref_id, []).append(clean)

    return cited


def _find_best_snippet(
    sentence: str, chunk_text: str, ngram_size: int = 4, min_snippet_len: int = 20
) -> str | None:
    """Find the best matching substring in chunk_text for a given sentence.

    Uses word-level n-gram overlap to locate the region in the chunk that
    best matches the sentence.  Returns the matching chunk substring or None.
    """
    if not sentence or not chunk_text:
        return None

    # Normalize whitespace
    sentence_norm = re.sub(r'\s+', ' ', sentence).strip().lower()
    chunk_norm = re.sub(r'\s+', ' ', chunk_text).strip()
    chunk_lower = chunk_norm.lower()

    # Try direct substring match first (fastest path)
    if sentence_norm in chunk_lower:
        idx = chunk_lower.index(sentence_norm)
        return chunk_norm[idx:idx + len(sentence_norm)]

    # Word-level n-gram sliding window
    sent_words = sentence_norm.split()
    if len(sent_words) < ngram_size:
        # Short sentence: try each word sequence as substring
        phrase = ' '.join(sent_words)
        if phrase in chunk_lower:
            idx = chunk_lower.index(phrase)
            return chunk_norm[idx:idx + len(phrase)]
        return None

    # Build n-grams from the sentence
    sent_ngrams: Set[str] = set()
    for i in range(len(sent_words) - ngram_size + 1):
        sent_ngrams.add(' '.join(sent_words[i:i + ngram_size]))

    if not sent_ngrams:
        return None

    # Slide a window over the chunk and score by n-gram overlap
    chunk_words = chunk_lower.split()
    # Use a window roughly 2x sentence length
    window_size = min(len(chunk_words), max(len(sent_words) * 2, 20))
    best_score = 0
    best_start = 0
    best_end = 0

    for start in range(0, max(1, len(chunk_words) - window_size + 1)):
        end = min(start + window_size, len(chunk_words))
        window_ngrams: Set[str] = set()
        for i in range(start, end - ngram_size + 1):
            window_ngrams.add(' '.join(chunk_words[i:i + ngram_size]))
        overlap = len(sent_ngrams & window_ngrams)
        if overlap > best_score:
            best_score = overlap
            best_start = start
            best_end = end

    # Require at least 30% n-gram overlap
    if best_score < max(1, len(sent_ngrams) * 0.3):
        return None

    # Convert word positions back to character positions in original chunk
    words_orig = chunk_norm.split()
    snippet_words = words_orig[best_start:best_end]
    snippet = ' '.join(snippet_words)

    return snippet if len(snippet) >= min_snippet_len else None


def extract_evidence_from_chunks(
    response_text: str, references: list
) -> None:
    """Extract evidence snippets by matching LLM response sentences to chunk text.

    For each [n] citation in the response, finds the citing sentence and
    locates the best matching region in the chunk content of reference n.
    Attaches evidence snippets to references in-place.

    This is purely programmatic — no LLM call required.
    """
    cited_sentences = _extract_cited_sentences(response_text)
    if not cited_sentences:
        return

    # Build ref_id -> combined chunk text mapping
    ref_chunks: Dict[str, str] = {}
    for ref in references:
        ref_id = str(ref.get("reference_id", ""))
        if not ref_id:
            continue
        parts: List[str] = []
        # From content field (plain text chunks)
        for c in (ref.get("content") or []):
            if c and isinstance(c, str):
                parts.append(c)
        # From structured_content field
        for sc in (ref.get("structured_content") or []):
            if isinstance(sc, dict):
                # Text content
                content = sc.get("content")
                if isinstance(content, dict):
                    parts.append(content.get("text", "") or content.get("raw", ""))
                elif isinstance(content, str):
                    parts.append(content)
                # Table body
                table = sc.get("table")
                if isinstance(table, dict) and table.get("body_markdown"):
                    parts.append(table["body_markdown"])
        ref_chunks[ref_id] = "\n".join(p for p in parts if p)

    # For each cited reference, find evidence snippets
    for ref in references:
        ref_id = str(ref.get("reference_id", ""))
        sentences = cited_sentences.get(ref_id)
        if not sentences:
            continue
        chunk_text = ref_chunks.get(ref_id, "")
        if not chunk_text:
            continue

        snippets: List[str] = []
        seen: Set[str] = set()
        for sent in sentences:
            snippet = _find_best_snippet(sent, chunk_text)
            if snippet and snippet not in seen:
                seen.add(snippet)
                snippets.append(snippet)

        if snippets:
            ref["evidence"] = snippets


def normalize_citations(text: str, valid_ids: Set[str]) -> str:
    """Normalize inline citation tags in the response text.

    1. Convert footnote-style [^n] to [n].
    2. Remove citations whose reference_id is not in valid_ids.
    3. Remove malformed non-numeric citations like [Knowledge Graph Data - ...].
    4. Strip any trailing References section (safety net).
    5. Clean up double spaces left by removals.
    """
    # 1. Convert [^n] → [n]
    text = re.sub(r"\[\^(\d{1,3})\]", r"[\1]", text)

    # 2. Remove citations with invalid reference_ids
    def _replace_invalid(m: re.Match) -> str:
        ref_id = m.group(1)
        return m.group(0) if ref_id in valid_ids else ""

    text = re.sub(r"\[(\d{1,3})\]", _replace_invalid, text)

    # 3. Remove malformed non-numeric bracket citations
    #    e.g. [Knowledge Graph Data - 환불], [table name], [entity - ...]
    #    but preserve valid markdown links [text](url) and images ![alt](url)
    def _remove_malformed(m: re.Match) -> str:
        inner = m.group(1)
        after = m.group(2) if m.group(2) else ""
        # Keep if followed by ( — it's a markdown link [text](url)
        if after.startswith("("):
            return m.group(0)
        # Keep pure numeric (already handled above)
        if re.fullmatch(r"\d{1,3}", inner):
            return m.group(0)
        # Remove anything else (non-numeric citations the LLM hallucinated)
        return ""

    text = re.sub(r"\[([^\[\]]{4,})\](\()?", _remove_malformed, text)

    # 4. Strip trailing References section
    text = strip_references_section(text)

    # 5. Clean up artifacts from removals
    text = re.sub(r"  +", " ", text)  # double spaces → single
    text = re.sub(r" +([.,;:!?])", r"\1", text)  # space before punctuation

    return text
