"""
HTML content parser using BeautifulSoup.

Extracts structured data: text, images, tables, and metadata.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from lightrag.utils import logger

try:
    from bs4 import BeautifulSoup, NavigableString, Tag

    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False
    logger.warning("beautifulsoup4 not installed. HTML parsing will be limited.")


@dataclass
class ExtractedImage:
    """Extracted image information."""

    src: str
    alt: str = ""
    title: str = ""
    context: str = ""


@dataclass
class ExtractedTable:
    """Extracted table information."""

    html: str
    markdown: str = ""
    caption: str = ""
    headers: List[str] = field(default_factory=list)
    rows: List[List[str]] = field(default_factory=list)


@dataclass
class ExtractedLink:
    """Extracted hyperlink information."""

    url: str
    text: str = ""
    is_internal: bool = False


@dataclass
class ParsedContent:
    """Parsed content from a web page."""

    url: str
    title: str = ""
    main_text: str = ""
    description: str = ""
    images: List[ExtractedImage] = field(default_factory=list)
    tables: List[ExtractedTable] = field(default_factory=list)
    links: List[ExtractedLink] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


class HTMLParser:
    """HTML content parser using BeautifulSoup."""

    REMOVE_TAGS = [
        "script", "style", "noscript", "iframe", "svg", "canvas",
        "video", "audio", "form", "input", "button", "select",
        "textarea", "nav", "footer", "header", "aside",
    ]

    BLOCK_TAGS = [
        "p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
        "li", "tr", "br", "hr", "blockquote", "pre",
    ]

    def __init__(
        self,
        extract_images: bool = True,
        extract_tables: bool = True,
        extract_links: bool = False,
        min_text_length: int = 50,
        max_images: int = 20,
        max_tables: int = 10,
        max_links: int = 50,
    ):
        if not HAS_BS4:
            raise ImportError(
                "beautifulsoup4 is required for HTML parsing. "
                "Install with: pip install beautifulsoup4 lxml"
            )
        self.extract_images = extract_images
        self.extract_tables = extract_tables
        self.extract_links = extract_links
        self.min_text_length = min_text_length
        self.max_images = max_images
        self.max_tables = max_tables
        self.max_links = max_links

    def parse(self, html_content: str, source_url: str) -> ParsedContent:
        """Parse HTML content and extract structured data."""
        try:
            soup = BeautifulSoup(html_content, "lxml")
        except Exception:
            soup = BeautifulSoup(html_content, "html.parser")

        result = ParsedContent(url=source_url)
        result.title = self._extract_title(soup)
        result.description = self._extract_description(soup)

        if self.extract_images:
            result.images = self._extract_images(soup, source_url)

        if self.extract_tables:
            result.tables = self._extract_tables(soup)

        if self.extract_links:
            result.links = self._extract_links(soup, source_url)

        result.main_text = self._extract_main_text(soup)

        result.metadata = {
            "image_count": len(result.images),
            "table_count": len(result.tables),
            "link_count": len(result.links),
            "text_length": len(result.main_text),
        }

        return result

    def _extract_title(self, soup: BeautifulSoup) -> str:
        title_tag = soup.find("title")
        if title_tag and title_tag.string:
            return title_tag.string.strip()

        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            return og_title["content"].strip()

        h1 = soup.find("h1")
        if h1:
            return h1.get_text(strip=True)

        return ""

    def _extract_description(self, soup: BeautifulSoup) -> str:
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc and meta_desc.get("content"):
            return meta_desc["content"].strip()

        og_desc = soup.find("meta", property="og:description")
        if og_desc and og_desc.get("content"):
            return og_desc["content"].strip()

        return ""

    def _extract_images(
        self, soup: BeautifulSoup, base_url: str
    ) -> List[ExtractedImage]:
        images = []

        for img in soup.find_all("img", limit=self.max_images * 2):
            src = img.get("src", "") or img.get("data-src", "")
            if not src:
                continue

            if src.startswith("data:"):
                continue

            src_lower = src.lower()
            if ".svg" in src_lower or src_lower.endswith(".svg"):
                continue

            width = img.get("width", "")
            height = img.get("height", "")
            if width and height:
                try:
                    if int(width) < 50 or int(height) < 50:
                        continue
                except ValueError:
                    pass

            absolute_url = urljoin(base_url, src)
            alt = img.get("alt", "").strip()
            title = img.get("title", "").strip()
            context = self._get_image_context(img)

            images.append(
                ExtractedImage(src=absolute_url, alt=alt, title=title, context=context)
            )

            if len(images) >= self.max_images:
                break

        return images

    def _get_image_context(self, img_tag: "Tag") -> str:
        context_parts = []

        parent = img_tag.parent
        if parent and parent.name == "figure":
            figcaption = parent.find("figcaption")
            if figcaption:
                context_parts.append(figcaption.get_text(strip=True))

        prev = img_tag.previous_sibling
        if prev and isinstance(prev, NavigableString):
            text = str(prev).strip()
            if text:
                context_parts.append(text[:200])

        next_sib = img_tag.next_sibling
        if next_sib and isinstance(next_sib, NavigableString):
            text = str(next_sib).strip()
            if text:
                context_parts.append(text[:200])

        return " ".join(context_parts)

    def _extract_tables(self, soup: BeautifulSoup) -> List[ExtractedTable]:
        tables = []
        for table in soup.find_all("table", limit=self.max_tables):
            try:
                extracted = self._parse_single_table(table)
                if extracted and (extracted.headers or extracted.rows):
                    tables.append(extracted)
            except Exception as e:
                logger.debug(f"Error parsing table: {e}")
                continue
        return tables

    def _extract_links(
        self, soup: BeautifulSoup, base_url: str
    ) -> List[ExtractedLink]:
        """Extract hyperlinks from HTML, classifying internal vs external."""
        from urllib.parse import urlparse

        base_parsed = urlparse(base_url)
        base_domain = base_parsed.netloc.lower().split(":")[0]
        if base_domain.startswith("www."):
            base_domain = base_domain[4:]

        links: List[ExtractedLink] = []
        seen_urls = set()

        # Skip links inside nav/footer/header (already removed by REMOVE_TAGS for text,
        # but we parse from original soup here)
        skip_parents = {"nav", "footer", "header", "aside"}

        for a_tag in soup.find_all("a", href=True, limit=self.max_links * 3):
            href = a_tag["href"].strip()
            if not href or href.startswith("#") or href.startswith("javascript:"):
                continue
            if href.startswith("mailto:") or href.startswith("tel:"):
                continue

            # Skip if inside nav/footer/header
            parent_names = {p.name for p in a_tag.parents if hasattr(p, "name")}
            if parent_names & skip_parents:
                continue

            absolute_url = urljoin(base_url, href)

            # Normalize for dedup
            try:
                parsed = urlparse(absolute_url)
                if parsed.scheme not in ("http", "https"):
                    continue
                normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
                if normalized.endswith("/") and len(parsed.path) > 1:
                    normalized = normalized.rstrip("/")
            except Exception:
                continue

            if normalized in seen_urls:
                continue
            seen_urls.add(normalized)

            # Classify internal vs external
            link_domain = parsed.netloc.lower().split(":")[0]
            if link_domain.startswith("www."):
                link_domain = link_domain[4:]
            is_internal = link_domain == base_domain

            link_text = a_tag.get_text(strip=True)[:200]

            links.append(ExtractedLink(
                url=absolute_url,
                text=link_text,
                is_internal=is_internal,
            ))

            if len(links) >= self.max_links:
                break

        return links

    def _parse_single_table(self, table: "Tag") -> Optional[ExtractedTable]:
        caption = ""
        caption_tag = table.find("caption")
        if caption_tag:
            caption = caption_tag.get_text(strip=True)

        headers = []
        header_row = table.find("thead")
        if header_row:
            for th in header_row.find_all(["th", "td"]):
                headers.append(th.get_text(strip=True))
        else:
            first_row = table.find("tr")
            if first_row:
                for cell in first_row.find_all(["th", "td"]):
                    headers.append(cell.get_text(strip=True))

        rows = []
        tbody = table.find("tbody") or table
        for tr in tbody.find_all("tr"):
            if tr == table.find("tr") and headers:
                continue
            row = []
            for cell in tr.find_all(["td", "th"]):
                row.append(cell.get_text(strip=True))
            if row:
                rows.append(row)

        markdown = self._table_to_markdown(headers, rows, caption)

        return ExtractedTable(
            html=str(table),
            markdown=markdown,
            caption=caption,
            headers=headers,
            rows=rows,
        )

    def _table_to_markdown(
        self, headers: List[str], rows: List[List[str]], caption: str = ""
    ) -> str:
        if not headers and not rows:
            return ""

        lines = []
        if caption:
            lines.append(f"**{caption}**\n")

        col_count = len(headers) if headers else (len(rows[0]) if rows else 0)
        if col_count == 0:
            return ""

        if headers:
            lines.append("| " + " | ".join(headers) + " |")
            lines.append("| " + " | ".join(["---"] * len(headers)) + " |")

        for row in rows:
            while len(row) < col_count:
                row.append("")
            lines.append("| " + " | ".join(row[:col_count]) + " |")

        return "\n".join(lines)

    def _extract_main_text(self, soup: BeautifulSoup) -> str:
        soup = BeautifulSoup(str(soup), "lxml")

        for tag in soup.find_all(self.REMOVE_TAGS):
            tag.decompose()

        main_content = None
        for selector in ["article", "main", '[role="main"]', ".content", "#content"]:
            main_content = soup.select_one(selector)
            if main_content:
                break

        if main_content:
            text = self._get_text_with_structure(main_content)
        else:
            body = soup.find("body")
            if body:
                text = self._get_text_with_structure(body)
            else:
                text = self._get_text_with_structure(soup)

        return self._clean_text(text)

    def _get_text_with_structure(self, element: "Tag") -> str:
        parts = []
        for child in element.children:
            if isinstance(child, NavigableString):
                text = str(child).strip()
                if text:
                    parts.append(text)
            elif isinstance(child, Tag):
                if child.name in self.BLOCK_TAGS:
                    parts.append("\n")
                child_text = self._get_text_with_structure(child)
                if child_text:
                    parts.append(child_text)
                if child.name in self.BLOCK_TAGS:
                    parts.append("\n")
        return " ".join(parts)

    def _clean_text(self, text: str) -> str:
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n\s*\n", "\n\n", text)
        lines = [line.strip() for line in text.split("\n")]
        text = "\n".join(lines)
        return text.strip()
