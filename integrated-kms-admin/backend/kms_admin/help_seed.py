from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


HELP_ROLES = ("user", "manager", "admin")


@dataclass(frozen=True)
class HelpSeedTopic:
    help_id: str
    nav_key: str
    menu_label: str
    title: str
    summary: str
    body_md: str
    status: str
    sort_order: int
    visibility: dict[str, bool]
    screenshot_path: str
    screenshot_caption: str


def _docs_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "docs" / "help"


def _split_markdown_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _extract_first_section_text(body: str) -> str:
    marker = "### 이 기능은 언제 사용하나요?"
    if marker not in body:
        return ""
    after = body.split(marker, 1)[1]
    after = after.split("\n### ", 1)[0].strip()
    lines = [line.strip() for line in after.splitlines() if line.strip()]
    return lines[0] if lines else ""


def _parse_content(content_md: str) -> dict[str, dict[str, str]]:
    pattern = re.compile(r"^## (HELP-[A-Z]+-\d+)\. (.+)$", re.MULTILINE)
    matches = list(pattern.finditer(content_md))
    topics: dict[str, dict[str, str]] = {}
    for index, match in enumerate(matches):
        help_id = match.group(1)
        title = match.group(2).strip()
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(content_md)
        body = content_md[start:end].strip()
        topics[help_id] = {
            "title": title,
            "body_md": body,
            "summary": _extract_first_section_text(body),
        }
    return topics


def _parse_settings(settings_md: str) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line in settings_md.splitlines():
        if not line.startswith("| HELP-"):
            continue
        cells = _split_markdown_table_row(line)
        if len(cells) < 9:
            continue
        help_id, menu_label, title, status = cells[:4]
        visibility = {
            "user": cells[4] == "Y",
            "manager": cells[5] == "Y",
            "admin": cells[6] == "Y",
        }
        rows.append(
            {
                "help_id": help_id,
                "menu_label": menu_label,
                "title": title,
                "status": status,
                "visibility": visibility,
                "screenshot_path": cells[7].strip("`"),
                "note": cells[8],
            }
        )
    return rows


def nav_key_for_help_id(help_id: str) -> str:
    prefix = help_id.split("-", 2)[1].lower()
    mapping = {
        "search": "search",
        "knowledge": "knowledge",
        "category": "categories",
        "jobs": "jobs",
        "stats": "stats",
        "external": "external",
        "users": "users",
        "tenants": "tenants",
        "system": "system",
    }
    return mapping.get(prefix, "help")


def load_help_seed_topics(docs_dir: Path | None = None) -> list[HelpSeedTopic]:
    source_dir = docs_dir or _docs_dir()
    content_path = source_dir / "HELP_CONTENT_DRAFT.md"
    settings_path = source_dir / "HELP_TOPIC_SETTINGS.md"
    if not content_path.exists() or not settings_path.exists():
        return []
    content_topics = _parse_content(content_path.read_text(encoding="utf-8"))
    settings_rows = _parse_settings(settings_path.read_text(encoding="utf-8"))
    seeds: list[HelpSeedTopic] = []
    for sort_order, row in enumerate(settings_rows, start=10):
        help_id = str(row["help_id"])
        content = content_topics.get(help_id)
        if not content:
            continue
        title = str(row["title"] or content["title"])
        seeds.append(
            HelpSeedTopic(
                help_id=help_id,
                nav_key=nav_key_for_help_id(help_id),
                menu_label=str(row["menu_label"]),
                title=title,
                summary=content["summary"] or str(row.get("note") or ""),
                body_md=content["body_md"],
                status=str(row["status"]),
                sort_order=sort_order * 10,
                visibility=dict(row["visibility"]),  # type: ignore[arg-type]
                screenshot_path=str(row["screenshot_path"]),
                screenshot_caption=f"{title} 화면",
            )
        )
    return seeds

